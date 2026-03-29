"""
Document ingestion pipeline.
Parses any supported file type → plain text → chunks → embeddings → FAISS index.
"""

import io
import os
import json
import uuid
import time
import logging
from pathlib import Path
from typing import Optional

import numpy as np
import faiss
import requests
from bs4 import BeautifulSoup
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
CHUNK_SIZE    = int(os.getenv("CHUNK_SIZE", 800))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", 150))
EMBED_DIM     = 1536

# ── Embedding client: Azure OpenAI (production) or OpenAI (dev/testing) ────────
_USE_AZURE = os.getenv("USE_AZURE_EMBEDDINGS", "false").lower() == "true"

if _USE_AZURE:
    from openai import AzureOpenAI
    _embed_client = AzureOpenAI(
        azure_endpoint=os.getenv("AZURE_ENDPOINT", ""),
        api_key=os.getenv("AZURE_KEY", ""),
        api_version=os.getenv("AZURE_API_VERSION", "2024-02-01"),
    )
    EMBED_MODEL = os.getenv("AZURE_EMBED_DEPLOYMENT", "text-embedding-3-small")
    logger.info(f"Embeddings: Azure OpenAI — deployment '{EMBED_MODEL}'")
else:
    from openai import OpenAI
    _embed_client = OpenAI()  # reads OPENAI_API_KEY from env
    EMBED_MODEL = "text-embedding-3-small"
    logger.info("Embeddings: OpenAI — text-embedding-3-small")

# ── Text Extractors ─────────────────────────────────────────────────────────────

def extract_pdf(content: bytes) -> str:
    import fitz  # PyMuPDF
    doc = fitz.open(stream=content, filetype="pdf")
    return "\n\n".join(page.get_text() for page in doc)


def extract_docx(content: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(content))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_excel(content: bytes) -> str:
    import pandas as pd
    xf = pd.ExcelFile(io.BytesIO(content))
    parts = []
    for sheet in xf.sheet_names:
        df = xf.parse(sheet).fillna("")
        parts.append(f"[Sheet: {sheet}]\n{df.to_string(index=False)}")
    return "\n\n".join(parts)


def extract_csv(content: bytes) -> str:
    import pandas as pd
    df = pd.read_csv(io.BytesIO(content)).fillna("")
    return df.to_string(index=False)


def extract_text(content: bytes) -> str:
    return content.decode("utf-8", errors="ignore")


def extract_url(url: str) -> str:
    r = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    soup = BeautifulSoup(r.content, "html.parser")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)


def extract_text_from_file(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return extract_pdf(content)
    elif ext in (".docx", ".doc"):
        return extract_docx(content)
    elif ext in (".xlsx", ".xls"):
        return extract_excel(content)
    elif ext == ".csv":
        return extract_csv(content)
    else:  # .txt, .md, .json, etc.
        return extract_text(content)


# ── Embedding ──────────────────────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> np.ndarray:
    """Embed a batch of texts. Returns float32 array (N, EMBED_DIM)."""
    response = _embed_client.embeddings.create(model=EMBED_MODEL, input=texts)
    vecs = [r.embedding for r in response.data]
    return np.array(vecs, dtype=np.float32)


# ── FAISS Store ────────────────────────────────────────────────────────────────

class KnowledgeBase:
    def __init__(self, storage_path: str):
        self.storage_path = Path(storage_path)
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.index_path    = self.storage_path / "faiss.index"
        self.meta_path     = self.storage_path / "metadata.json"
        self.splitter      = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
        )
        self._load()

    def _load(self):
        if self.index_path.exists():
            self.index = faiss.read_index(str(self.index_path))
        else:
            self.index = faiss.IndexFlatL2(EMBED_DIM)

        if self.meta_path.exists():
            with open(self.meta_path) as f:
                self.metadata: list[dict] = json.load(f)
        else:
            self.metadata: list[dict] = []

    def _save(self):
        faiss.write_index(self.index, str(self.index_path))
        with open(self.meta_path, "w") as f:
            json.dump(self.metadata, f, indent=2)

    # ── Ingest ────────────────────────────────────────────────────────────────

    def ingest_file(self, filename: str, content: bytes, category: str = "general") -> dict:
        doc_id   = str(uuid.uuid4())
        raw_text = extract_text_from_file(filename, content)
        if not raw_text.strip():
            raise ValueError(f"No text could be extracted from {filename}")

        chunks = self.splitter.split_text(raw_text)
        if not chunks:
            raise ValueError("Document produced no chunks after splitting")

        vectors = embed_texts(chunks)
        # Normalize for cosine similarity via L2 on normalised vectors
        faiss.normalize_L2(vectors)
        self.index.add(vectors)

        first_idx = len(self.metadata)
        for i, chunk in enumerate(chunks):
            self.metadata.append({
                "doc_id":     doc_id,
                "chunk_idx":  i,
                "faiss_idx":  first_idx + i,
                "filename":   filename,
                "category":   category,
                "text":       chunk,
                "ingested_at": int(time.time()),
            })

        self._save()
        logger.info(f"Ingested {filename} → {len(chunks)} chunks (doc_id={doc_id})")
        return {"doc_id": doc_id, "filename": filename, "chunks": len(chunks)}

    def ingest_url(self, url: str, category: str = "general") -> dict:
        raw_text = extract_url(url)
        # Treat the URL as the "filename"
        return self.ingest_file(url, raw_text.encode(), category)

    # ── Query ─────────────────────────────────────────────────────────────────

    def query(self, question: str, top_k: int = 5) -> list[dict]:
        if self.index.ntotal == 0:
            return []
        vec = embed_texts([question])
        faiss.normalize_L2(vec)
        distances, indices = self.index.search(vec, min(top_k, self.index.ntotal))
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < 0 or idx >= len(self.metadata):
                continue
            meta = self.metadata[idx]
            results.append({
                "text":     meta["text"],
                "filename": meta["filename"],
                "category": meta["category"],
                "score":    float(1 - dist / 2),  # cosine similarity approx
                "doc_id":   meta["doc_id"],
            })
        return results

    # ── List & Delete ─────────────────────────────────────────────────────────

    def list_documents(self) -> list[dict]:
        seen: dict[str, dict] = {}
        for m in self.metadata:
            if m["doc_id"] not in seen:
                seen[m["doc_id"]] = {
                    "doc_id":      m["doc_id"],
                    "filename":    m["filename"],
                    "category":    m["category"],
                    "chunks":      0,
                    "ingested_at": m["ingested_at"],
                }
            seen[m["doc_id"]]["chunks"] += 1
        return list(seen.values())

    def delete_document(self, doc_id: str) -> bool:
        """Remove all chunks of a document and rebuild the FAISS index."""
        keep = [m for m in self.metadata if m["doc_id"] != doc_id]
        if len(keep) == len(self.metadata):
            return False  # doc not found

        if not keep:
            self.index = faiss.IndexFlatL2(EMBED_DIM)
            self.metadata = []
        else:
            # Re-embed all remaining chunks and rebuild index from scratch
            texts   = [m["text"] for m in keep]
            vectors = embed_texts(texts)
            faiss.normalize_L2(vectors)
            self.index = faiss.IndexFlatL2(EMBED_DIM)
            self.index.add(vectors)
            for i, m in enumerate(keep):
                m["faiss_idx"] = i
            self.metadata = keep

        self._save()
        logger.info(f"Deleted doc {doc_id}, {len(self.metadata)} chunks remain")
        return True
