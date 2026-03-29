"""
Trane & ThermoKing Knowledge Base RAG Service
FastAPI microservice — runs on port 8000
Node.js backend calls /query to get context before answering customer
"""

import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ingestion import KnowledgeBase

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

# ── Globals ────────────────────────────────────────────────────────────────────
KB_PATH = os.getenv("KB_STORAGE_PATH", "./knowledge_base")
TOP_K   = int(os.getenv("TOP_K_RESULTS", 5))

kb: KnowledgeBase | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global kb
    logger.info(f"Loading knowledge base from {KB_PATH} …")
    kb = KnowledgeBase(storage_path=KB_PATH)
    logger.info(f"KB ready — {kb.index.ntotal} vectors, {len(kb.list_documents())} documents")
    yield
    logger.info("RAG service shutting down")


app = FastAPI(title="Trane KB RAG Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "vectors": kb.index.ntotal if kb else 0,
        "documents": len(kb.list_documents()) if kb else 0,
    }


# ── Ingest: file upload ────────────────────────────────────────────────────────

@app.post("/ingest")
async def ingest_file(
    file: UploadFile = File(...),
    category: str    = Form("general"),
):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")

    content = await file.read()
    if len(content) > 50 * 1024 * 1024:  # 50 MB limit
        raise HTTPException(413, "File too large (max 50 MB)")

    try:
        result = kb.ingest_file(file.filename, content, category)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"Ingest error: {e}")
        raise HTTPException(500, "Ingestion failed — check server logs")


# ── Ingest: URL ────────────────────────────────────────────────────────────────

class UrlIngestRequest(BaseModel):
    url: str
    category: str = "general"


@app.post("/ingest/url")
def ingest_url(req: UrlIngestRequest):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    try:
        result = kb.ingest_url(req.url, req.category)
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"URL ingest error: {e}")
        raise HTTPException(500, str(e))


# ── Query ─────────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str
    top_k: int = TOP_K


@app.post("/query")
def query(req: QueryRequest):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    if not req.question.strip():
        raise HTTPException(422, "question is required")

    results = kb.query(req.question, top_k=req.top_k)
    # Return context as a single joined string + individual chunks for transparency
    context = "\n\n---\n\n".join(
        f"[Source: {r['filename']}]\n{r['text']}" for r in results
    )
    return {
        "context": context,
        "chunks":  results,
        "total":   len(results),
    }


# ── List documents ─────────────────────────────────────────────────────────────

@app.get("/documents")
def list_documents():
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    return {"documents": kb.list_documents()}


# ── Delete document ────────────────────────────────────────────────────────────

@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    deleted = kb.delete_document(doc_id)
    if not deleted:
        raise HTTPException(404, f"Document {doc_id} not found")
    return {"success": True, "doc_id": doc_id}


# ── Dev run ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
