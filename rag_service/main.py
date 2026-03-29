"""
Trane & ThermoKing Knowledge Base RAG Service
FastAPI microservice — runs on port 8000
Node.js backend calls /query to get context before answering customer.

Answer sourcing priority:
  1. FAISS knowledge base (uploaded company docs)
  2. Web search restricted to trane.com / thermoking.com (if Tavily key set)
  3. Neither found → returns empty context; Node.js tells AI to say "I don't know"
"""

import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ingestion import KnowledgeBase
from web_search import search_official_sites

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────────
KB_PATH          = os.getenv("KB_STORAGE_PATH", "./knowledge_base")
TOP_K            = int(os.getenv("TOP_K_RESULTS", 5))
MIN_SCORE        = float(os.getenv("MIN_RELEVANCE_SCORE", "0.25"))  # chunks below this are dropped
ENABLE_WEB_SEARCH = bool(os.getenv("TAVILY_API_KEY", ""))

kb: KnowledgeBase | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global kb
    logger.info(f"Loading knowledge base from {KB_PATH} …")
    kb = KnowledgeBase(storage_path=KB_PATH)
    docs = kb.list_documents()
    logger.info(f"KB ready — {kb.index_total} vectors, {len(docs)} documents")
    if ENABLE_WEB_SEARCH:
        logger.info("Web search fallback: ENABLED (Tavily)")
    else:
        logger.info("Web search fallback: DISABLED (set TAVILY_API_KEY to enable)")
    yield
    logger.info("RAG service shutting down")


app = FastAPI(title="Trane KB RAG Service", version="1.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ──────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    from ingestion import USE_AZURE_EMBED
    return {
        "status":       "ok",
        "vectors":      kb.index_total if kb else 0,
        "documents":    len(kb.list_documents()) if kb else 0,
        "web_search":   ENABLE_WEB_SEARCH,
        "vector_db":    "pinecone",
        "embed_mode":   "azure/text-embedding-3-small" if USE_AZURE_EMBED else "pinecone/multilingual-e5-large",
    }


# ── Ingest: file upload ─────────────────────────────────────────────────────────
@app.post("/ingest")
async def ingest_file(
    file: UploadFile = File(...),
    category: str    = Form("general"),
):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 50 MB)")
    try:
        result = kb.ingest_file(file.filename, content, category)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"Ingest error: {e}")
        raise HTTPException(500, "Ingestion failed — check server logs")


# ── Ingest: URL ─────────────────────────────────────────────────────────────────
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


# ── Query — KB → web fallback ───────────────────────────────────────────────────
class QueryRequest(BaseModel):
    question: str
    top_k: int = TOP_K


@app.post("/query")
async def query(req: QueryRequest):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    if not req.question.strip():
        raise HTTPException(422, "question is required")

    # ── Step 1: KB search ────────────────────────────────────────────────────
    raw_results = kb.query(req.question, top_k=req.top_k)
    # Filter to only high-confidence chunks
    kb_results = [r for r in raw_results if r["score"] >= MIN_SCORE]

    if kb_results:
        context = "\n\n---\n\n".join(
            f"[Source: {r['filename']} | Category: {r['category']}]\n{r['text']}"
            for r in kb_results
        )
        return {
            "context":  context,
            "chunks":   kb_results,
            "total":    len(kb_results),
            "source":   "knowledge_base",
            "grounded": True,
        }

    # ── Step 2: Web search fallback (trane.com + thermoking.com only) ────────
    if ENABLE_WEB_SEARCH:
        logger.info(f"KB miss for '{req.question[:60]}' — trying web search")
        web_results = await search_official_sites(req.question)
        if web_results:
            context = "\n\n---\n\n".join(
                f"[Source: {r['url']}]\n{r['content']}" for r in web_results
            )
            return {
                "context":  context,
                "chunks":   web_results,
                "total":    len(web_results),
                "source":   "web_search",
                "grounded": True,
            }

    # ── Step 3: Nothing found — tell Node.js not to hallucinate ─────────────
    logger.info(f"No grounded answer found for: '{req.question[:60]}'")
    return {
        "context":  "",
        "chunks":   [],
        "total":    0,
        "source":   "none",
        "grounded": False,
    }


# ── List documents ──────────────────────────────────────────────────────────────
@app.get("/documents")
def list_documents():
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    return {"documents": kb.list_documents()}


# ── Delete document ─────────────────────────────────────────────────────────────
@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    deleted = kb.delete_document(doc_id)
    if not deleted:
        raise HTTPException(404, f"Document {doc_id} not found")
    return {"success": True, "doc_id": doc_id}


# ── Dev run ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
