"""
Document ingestion pipeline — Pinecone vector store.

Pinecone handles BOTH storage AND embeddings via its built-in inference model
(multilingual-e5-large). No OpenAI / Azure embedding key required.

Flow:
  File/URL → parse → plain text → chunks → Pinecone upsert (with inference)
  Query    → Pinecone semantic search (with inference) → top-K chunks
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
from pinecone import Pinecone, ServerlessSpec
from langchain_text_splitters import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

# ── Config ─────────────────────────────────────────────────────────────────────
PINECONE_KEY   = os.getenv("PINECONE_API_KEY", "")
INDEX_NAME     = os.getenv("PINECONE_INDEX_NAME", "trane-thermoking-kb")
PINECONE_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")

# Pinecone's built-in embedding model — no external key needed
# multilingual-e5-large: 1024-dim, supports English + many languages
EMBED_MODEL    = "multilingual-e5-large"
EMBED_DIM      = 1024

CHUNK_SIZE     = int(os.getenv("CHUNK_SIZE", 800))
CHUNK_OVERLAP  = int(os.getenv("CHUNK_OVERLAP", 150))

# Local metadata store (Pinecone doesn't store arbitrary metadata well for listing)
# We keep a small JSON file to track doc_id → filename, category, chunk count
META_DIR       = Path(os.getenv("KB_STORAGE_PATH", "./knowledge_base"))


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
    else:
        return extract_text(content)


# ── Knowledge Base ─────────────────────────────────────────────────────────────

class KnowledgeBase:
    def __init__(self, storage_path: str = "./knowledge_base"):
        if not PINECONE_KEY:
            raise RuntimeError("PINECONE_API_KEY is not set in .env")

        self.meta_dir  = Path(storage_path)
        self.meta_dir.mkdir(parents=True, exist_ok=True)
        self.meta_path = self.meta_dir / "metadata.json"
        self.splitter  = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
        )

        # Connect to Pinecone
        self.pc = Pinecone(api_key=PINECONE_KEY)
        self._ensure_index()
        self._load_meta()

    def _ensure_index(self):
        """Create the Pinecone index if it doesn't exist yet."""
        existing = [idx.name for idx in self.pc.list_indexes()]
        if INDEX_NAME not in existing:
            logger.info(f"Creating Pinecone index '{INDEX_NAME}' …")
            self.pc.create_index_for_model(
                name=INDEX_NAME,
                cloud=PINECONE_CLOUD,
                region=PINECONE_REGION,
                embed={
                    "model":       EMBED_MODEL,
                    "field_map":   {"text": "chunk_text"},   # field to embed
                },
            )
            # Wait until ready
            while not self.pc.describe_index(INDEX_NAME).status.ready:
                time.sleep(1)
            logger.info(f"Index '{INDEX_NAME}' ready")
        self.index = self.pc.Index(INDEX_NAME)

    def _load_meta(self):
        if self.meta_path.exists():
            with open(self.meta_path) as f:
                self.metadata: dict = json.load(f)  # {doc_id: {filename, category, chunks, ingested_at}}
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

        # Pinecone upsert format for inference-enabled index:
        # Each record has an _id and the text field that gets embedded
        records = []
        for i, chunk in enumerate(chunks):
            records.append({
                "_id":        f"{doc_id}#{i}",
                "chunk_text": chunk,           # this field is embedded by Pinecone
                "doc_id":     doc_id,
                "filename":   filename,
                "category":   category,
                "chunk_idx":  i,
            })

        # Upsert in batches of 96 (Pinecone limit for inference upserts)
        batch_size = 96
        for start in range(0, len(records), batch_size):
            self.index.upsert_records(
                namespace="kb",
                records=records[start : start + batch_size],
            )

        # Store doc metadata locally for listing/deletion
        self.metadata[doc_id] = {
            "doc_id":      doc_id,
            "filename":    filename,
            "category":    category,
            "chunks":      len(chunks),
            "ingested_at": int(time.time()),
            "chunk_ids":   [f"{doc_id}#{i}" for i in range(len(chunks))],
        }
        self._save_meta()

        logger.info(f"Ingested '{filename}' → {len(chunks)} chunks (doc_id={doc_id})")
        return {"doc_id": doc_id, "filename": filename, "chunks": len(chunks)}

    def ingest_url(self, url: str, category: str = "general") -> dict:
        raw_text = extract_url(url)
        return self.ingest_file(url, raw_text.encode(), category)

    # ── Query ─────────────────────────────────────────────────────────────────

    def query(self, question: str, top_k: int = 5) -> list[dict]:
        """Semantic search using Pinecone inference — no embedding key needed."""
        results = self.index.search(
            namespace="kb",
            query={"inputs": {"text": question}, "top_k": top_k},
            fields=["chunk_text", "filename", "category", "doc_id"],
        )

        hits = []
        for match in results.get("result", {}).get("hits", []):
            fields = match.get("fields", {})
            hits.append({
                "text":     fields.get("chunk_text", ""),
                "filename": fields.get("filename", ""),
                "category": fields.get("category", ""),
                "doc_id":   fields.get("doc_id", ""),
                "score":    match.get("_score", 0.0),
            })
        return hits

    # ── List ─────────────────────────────────────────────────────────────────

    def list_documents(self) -> list[dict]:
        return list(self.metadata.values())

    # ── Delete ────────────────────────────────────────────────────────────────

    def delete_document(self, doc_id: str) -> bool:
        if doc_id not in self.metadata:
            return False
        chunk_ids = self.metadata[doc_id].get("chunk_ids", [])
        if chunk_ids:
            # Pinecone delete by vector IDs
            self.index.delete(ids=chunk_ids, namespace="kb")
        del self.metadata[doc_id]
        self._save_meta()
        logger.info(f"Deleted doc {doc_id} ({len(chunk_ids)} chunks removed)")
        return True

    @property
    def index_total(self) -> int:
        """Approximate vector count from Pinecone stats."""
        try:
            stats = self.index.describe_index_stats()
            return stats.get("total_vector_count", 0)
        except Exception:
            return 0
