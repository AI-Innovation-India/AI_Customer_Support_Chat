"""
Document ingestion pipeline — Azure OpenAI embeddings + Pinecone vector store.

Embedding model : text-embedding-3-small (via Azure OpenAI — same key as chat)
Vector store    : Pinecone serverless (standard index, 1536-dim)

Flow:
  File/URL → parse → plain text → chunks
           → Azure OpenAI embeds each chunk
           → Pinecone stores vectors + metadata
  Query    → Azure OpenAI embeds query → Pinecone similarity search → top-K
"""

import io
import os
import json
import uuid
import time
import logging
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from openai import AzureOpenAI
from pinecone import Pinecone, ServerlessSpec
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────────
PINECONE_KEY    = os.getenv("PINECONE_API_KEY", "")
INDEX_NAME      = os.getenv("PINECONE_INDEX_NAME", "trane-thermoking-kb")
PINECONE_CLOUD  = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")

# Azure OpenAI — text-embedding-3-small (1536 dimensions)
AZURE_ENDPOINT    = os.getenv("AZURE_ENDPOINT", "")
AZURE_KEY         = os.getenv("AZURE_KEY", "")
AZURE_API_VERSION = os.getenv("AZURE_API_VERSION", "2024-02-01")
EMBED_DEPLOYMENT  = os.getenv("AZURE_EMBED_DEPLOYMENT", "text-embedding-3-small")
EMBED_DIM         = 1536

CHUNK_SIZE    = int(os.getenv("CHUNK_SIZE", 800))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", 150))
BATCH_SIZE    = 100   # vectors per Pinecone upsert call

if not AZURE_ENDPOINT or not AZURE_KEY:
    raise RuntimeError("AZURE_ENDPOINT and AZURE_KEY must be set in rag_service/.env")
if not PINECONE_KEY:
    raise RuntimeError("PINECONE_API_KEY must be set in rag_service/.env")

# ── Clients ─────────────────────────────────────────────────────────────────────
_embed_client = AzureOpenAI(
    azure_endpoint=AZURE_ENDPOINT,
    api_key=AZURE_KEY,
    api_version=AZURE_API_VERSION,
)


# ── Text Extractors ─────────────────────────────────────────────────────────────

def extract_pdf(content: bytes) -> str:
    import fitz
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
    else:
        return extract_text(content)


# ── Embeddings ──────────────────────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch via Azure OpenAI text-embedding-3-small."""
    response = _embed_client.embeddings.create(
        model=EMBED_DEPLOYMENT,
        input=texts,
    )
    return [r.embedding for r in response.data]


# ── Knowledge Base ──────────────────────────────────────────────────────────────

class KnowledgeBase:
    def __init__(self, storage_path: str = "./knowledge_base"):
        self.meta_dir  = Path(storage_path)
        self.meta_dir.mkdir(parents=True, exist_ok=True)
        self.meta_path = self.meta_dir / "metadata.json"
        self.splitter  = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
        )
        self.pc = Pinecone(api_key=PINECONE_KEY)
        self._ensure_index()
        self._load_meta()

    def _ensure_index(self):
        existing = [idx.name for idx in self.pc.list_indexes()]
        if INDEX_NAME not in existing:
            logger.info(f"Creating Pinecone index '{INDEX_NAME}' (dim={EMBED_DIM}) …")
            self.pc.create_index(
                name=INDEX_NAME,
                dimension=EMBED_DIM,
                metric="cosine",
                spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION),
            )
            while not self.pc.describe_index(INDEX_NAME).status.ready:
                time.sleep(1)
            logger.info(f"Index '{INDEX_NAME}' ready")
        self.index = self.pc.Index(INDEX_NAME)

    def _load_meta(self):
        if self.meta_path.exists():
            with open(self.meta_path) as f:
                self.metadata: dict = json.load(f)
        else:
            self.metadata: dict = {}

    def _save_meta(self):
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

        chunk_ids = [f"{doc_id}#{i}" for i in range(len(chunks))]

        # Embed in batches (Azure has per-request token limits)
        all_vectors = []
        for i in range(0, len(chunks), BATCH_SIZE):
            batch_texts = chunks[i : i + BATCH_SIZE]
            batch_vecs  = embed_texts(batch_texts)
            for j, (vec, text) in enumerate(zip(batch_vecs, batch_texts)):
                idx = i + j
                all_vectors.append({
                    "id":     chunk_ids[idx],
                    "values": vec,
                    "metadata": {
                        "doc_id":   doc_id,
                        "filename": filename,
                        "category": category,
                        "text":     text,         # stored so we can retrieve it
                    },
                })

        # Upsert to Pinecone in batches
        for i in range(0, len(all_vectors), BATCH_SIZE):
            self.index.upsert(
                vectors=all_vectors[i : i + BATCH_SIZE],
                namespace="kb",
            )

        self.metadata[doc_id] = {
            "doc_id":      doc_id,
            "filename":    filename,
            "category":    category,
            "chunks":      len(chunks),
            "ingested_at": int(time.time()),
            "chunk_ids":   chunk_ids,
        }
        self._save_meta()

        logger.info(f"Ingested '{filename}' → {len(chunks)} chunks (doc_id={doc_id})")
        return {"doc_id": doc_id, "filename": filename, "chunks": len(chunks)}

    def ingest_url(self, url: str, category: str = "general") -> dict:
        raw_text = extract_url(url)
        return self.ingest_file(url, raw_text.encode(), category)

    # ── Query ─────────────────────────────────────────────────────────────────

    def query(self, question: str, top_k: int = 5) -> list[dict]:
        """Embed question via Azure OpenAI → cosine search in Pinecone."""
        vec = embed_texts([question])[0]
        results = self.index.query(
            vector=vec,
            top_k=top_k,
            namespace="kb",
            include_metadata=True,
        )
        hits = []
        for match in results.get("matches", []):
            meta = match.get("metadata", {})
            hits.append({
                "text":     meta.get("text", ""),
                "filename": meta.get("filename", ""),
                "category": meta.get("category", ""),
                "doc_id":   meta.get("doc_id", ""),
                "score":    match.get("score", 0.0),
            })
        return hits

    # ── List & Delete ─────────────────────────────────────────────────────────

    def list_documents(self) -> list[dict]:
        return list(self.metadata.values())

    def delete_document(self, doc_id: str) -> bool:
        if doc_id not in self.metadata:
            return False
        chunk_ids = self.metadata[doc_id].get("chunk_ids", [])
        if chunk_ids:
            self.index.delete(ids=chunk_ids, namespace="kb")
        del self.metadata[doc_id]
        self._save_meta()
        logger.info(f"Deleted doc {doc_id} ({len(chunk_ids)} chunks)")
        return True

    @property
    def index_total(self) -> int:
        try:
            stats = self.index.describe_index_stats()
            ns = stats.get("namespaces", {}).get("kb", {})
            return ns.get("vector_count", 0)
        except Exception:
            return 0
