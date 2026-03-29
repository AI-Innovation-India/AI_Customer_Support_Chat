"""
Document ingestion pipeline — auto-selects embedding strategy:

  Priority 1: Azure OpenAI text-embedding-3-small
              (if AZURE_ENDPOINT + AZURE_KEY + AZURE_EMBED_DEPLOYMENT are set
               AND the deployment actually responds)

  Priority 2: Pinecone built-in multilingual-e5-large
              (no external key needed — Pinecone does the embedding)
              Used automatically if Azure is not configured or fails.

Two separate Pinecone index types are used:
  - Azure path  → standard cosine index (dim=1536, you supply vectors)
  - Pinecone path → inference index (Pinecone supplies vectors)

On startup the service logs which mode it chose.
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

# ── Config ──────────────────────────────────────────────────────────────────────
PINECONE_KEY    = os.getenv("PINECONE_API_KEY", "")
INDEX_NAME      = os.getenv("PINECONE_INDEX_NAME", "trane-thermoking-kb")
PINECONE_CLOUD  = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")

AZURE_ENDPOINT    = os.getenv("AZURE_ENDPOINT", "")
AZURE_KEY         = os.getenv("AZURE_KEY", "")
AZURE_API_VERSION = os.getenv("AZURE_API_VERSION", "2024-02-01")
EMBED_DEPLOYMENT  = os.getenv("AZURE_EMBED_DEPLOYMENT", "text-embedding-3-small")

CHUNK_SIZE    = int(os.getenv("CHUNK_SIZE", 800))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", 150))
BATCH_SIZE    = 96

if not PINECONE_KEY:
    raise RuntimeError("PINECONE_API_KEY must be set in rag_service/.env")


# ── Detect embedding mode at startup ───────────────────────────────────────────

def _try_azure_embeddings() -> bool:
    """Return True if Azure embedding deployment is reachable and works."""
    if not AZURE_ENDPOINT or not AZURE_KEY:
        return False
    try:
        from openai import AzureOpenAI
        client = AzureOpenAI(
            azure_endpoint=AZURE_ENDPOINT,
            api_key=AZURE_KEY,
            api_version=AZURE_API_VERSION,
        )
        # Quick test with a short string — if it throws, Azure isn't available
        client.embeddings.create(model=EMBED_DEPLOYMENT, input=["test"])
        return True
    except Exception as e:
        logger.warning(f"Azure embeddings not available ({e}) — will use Pinecone built-in")
        return False


USE_AZURE_EMBED = _try_azure_embeddings()

if USE_AZURE_EMBED:
    from openai import AzureOpenAI as _AzureOpenAI
    _azure_client = _AzureOpenAI(
        azure_endpoint=AZURE_ENDPOINT,
        api_key=AZURE_KEY,
        api_version=AZURE_API_VERSION,
    )
    EMBED_DIM = 1536
    logger.info(f"Embedding mode: Azure OpenAI — {EMBED_DEPLOYMENT} (dim={EMBED_DIM})")
else:
    _azure_client = None
    EMBED_DIM = None   # Pinecone inference index — dim is managed by Pinecone
    logger.info("Embedding mode: Pinecone built-in — multilingual-e5-large")


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


# ── Embedding helper (Azure path only) ─────────────────────────────────────────

def _azure_embed(texts: list[str]) -> list[list[float]]:
    response = _azure_client.embeddings.create(model=EMBED_DEPLOYMENT, input=texts)
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

    # ── Index creation (differs by embedding mode) ────────────────────────────

    def _ensure_index(self):
        existing = [idx.name for idx in self.pc.list_indexes()]

        if INDEX_NAME not in existing:
            if USE_AZURE_EMBED:
                # Standard index — we supply pre-computed 1536-dim vectors
                logger.info(f"Creating standard Pinecone index '{INDEX_NAME}' (dim=1536) …")
                self.pc.create_index(
                    name=INDEX_NAME,
                    dimension=1536,
                    metric="cosine",
                    spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION),
                )
            else:
                # Inference index — Pinecone embeds using multilingual-e5-large
                logger.info(f"Creating Pinecone inference index '{INDEX_NAME}' …")
                self.pc.create_index_for_model(
                    name=INDEX_NAME,
                    cloud=PINECONE_CLOUD,
                    region=PINECONE_REGION,
                    embed={
                        "model":     "multilingual-e5-large",
                        "field_map": {"text": "chunk_text"},
                    },
                )

            while not self.pc.describe_index(INDEX_NAME).status.ready:
                time.sleep(1)
            logger.info(f"Index '{INDEX_NAME}' ready")

        self.index = self.pc.Index(INDEX_NAME)

    # ── Metadata ──────────────────────────────────────────────────────────────

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

        # ── Step 1: Pinecone vector store (always, fast) ──────────────────────
        if USE_AZURE_EMBED:
            self._upsert_azure(doc_id, filename, category, chunks, chunk_ids)
        else:
            self._upsert_pinecone_inference(doc_id, filename, category, chunks, chunk_ids)

        self.metadata[doc_id] = {
            "doc_id":      doc_id,
            "filename":    filename,
            "category":    category,
            "chunks":      len(chunks),
            "ingested_at": int(time.time()),
            "chunk_ids":   chunk_ids,
            "embed_mode":  "azure" if USE_AZURE_EMBED else "pinecone",
        }
        self._save_meta()
        logger.info(f"Pinecone: ingested '{filename}' → {len(chunks)} chunks (doc_id={doc_id})")

        # ── Step 2: KG ingestion returned to caller as background task ────────
        # main.py schedules kg.ingest_chunks(doc_id, filename, chunks) async
        # so the HTTP response returns immediately after Pinecone is done
        return {"doc_id": doc_id, "filename": filename, "chunks": len(chunks), "_chunks": chunks}

    def _upsert_azure(self, doc_id, filename, category, chunks, chunk_ids):
        """Pre-compute embeddings via Azure then upsert vectors to Pinecone."""
        all_vectors = []
        for i in range(0, len(chunks), BATCH_SIZE):
            batch     = chunks[i : i + BATCH_SIZE]
            embeddings = _azure_embed(batch)
            for j, (vec, text) in enumerate(zip(embeddings, batch)):
                all_vectors.append({
                    "id":     chunk_ids[i + j],
                    "values": vec,
                    "metadata": {
                        "doc_id":   doc_id,
                        "filename": filename,
                        "category": category,
                        "text":     text,
                    },
                })
        for i in range(0, len(all_vectors), BATCH_SIZE):
            self.index.upsert(vectors=all_vectors[i : i + BATCH_SIZE], namespace="kb")

    def _upsert_pinecone_inference(self, doc_id, filename, category, chunks, chunk_ids):
        """Send raw text; Pinecone embeds using multilingual-e5-large."""
        records = []
        for i, chunk in enumerate(chunks):
            records.append({
                "_id":        chunk_ids[i],
                "chunk_text": chunk,        # Pinecone embeds this field
                "doc_id":     doc_id,
                "filename":   filename,
                "category":   category,
            })
        for i in range(0, len(records), BATCH_SIZE):
            self.index.upsert_records(
                namespace="kb",
                records=records[i : i + BATCH_SIZE],
            )

    def ingest_url(self, url: str, category: str = "general") -> dict:
        raw_text = extract_url(url)
        return self.ingest_file(url, raw_text.encode(), category)

    # ── Query ─────────────────────────────────────────────────────────────────

    def query(self, question: str, top_k: int = 5) -> list[dict]:
        if USE_AZURE_EMBED:
            return self._query_azure(question, top_k)
        else:
            return self._query_pinecone_inference(question, top_k)

    def _query_azure(self, question: str, top_k: int) -> list[dict]:
        vec = _azure_embed([question])[0]
        results = self.index.query(
            vector=vec, top_k=top_k, namespace="kb", include_metadata=True
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

    def _query_pinecone_inference(self, question: str, top_k: int) -> list[dict]:
        results = self.index.search(
            namespace="kb",
            query={"inputs": {"text": question}, "top_k": top_k},
            fields=["chunk_text", "filename", "category", "doc_id"],
        )
        hits = []
        # Pinecone v8 returns objects; use getattr with fallback for safety
        raw_hits = []
        try:
            raw_hits = results.result.hits
        except AttributeError:
            # Fallback: dict-style response
            raw_hits = results.get("result", {}).get("hits", [])

        for match in raw_hits:
            try:
                fields = match.fields
                hits.append({
                    "text":     getattr(fields, "chunk_text", "") or "",
                    "filename": getattr(fields, "filename", "") or "",
                    "category": getattr(fields, "category", "") or "",
                    "doc_id":   getattr(fields, "doc_id", "") or "",
                    "score":    getattr(match, "_score", 0.0) or 0.0,
                })
            except AttributeError:
                # Fallback: dict-style match
                f = match.get("fields", {})
                hits.append({
                    "text":     f.get("chunk_text", ""),
                    "filename": f.get("filename", ""),
                    "category": f.get("category", ""),
                    "doc_id":   f.get("doc_id", ""),
                    "score":    match.get("_score", 0.0),
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
            # Pinecone v8: delete accepts ids list; namespace as kwarg
            self.index.delete(ids=chunk_ids, namespace="kb")
        del self.metadata[doc_id]
        self._save_meta()
        logger.info(f"Deleted doc {doc_id} ({len(chunk_ids)} chunks)")
        return True

    @property
    def index_total(self) -> int:
        try:
            stats = self.index.describe_index_stats()
            # Pinecone v8 returns an object; try attribute access first
            try:
                ns = stats.namespaces.get("kb", None)
                return ns.vector_count if ns else 0
            except AttributeError:
                ns = stats.get("namespaces", {}).get("kb", {})
                return ns.get("vector_count", 0)
        except Exception:
            return 0
