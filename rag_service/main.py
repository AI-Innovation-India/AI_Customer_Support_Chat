"""
Trane & ThermoKing Knowledge Base — RAG + KG Service
FastAPI microservice on port 8000.

Dual-layer retrieval per query:
  Layer 1 — Pinecone vector search  : finds similar text chunks (fast, always on)
  Layer 2 — Neo4j KG graph search   : extracts entity relationships (richer, optional)

Both results are merged and returned to Node.js as a single grounded context block.
Node.js injects it into Yazhi's system prompt before calling Groq/Azure for the answer.

KG ingestion runs as a background task so file uploads return immediately.
"""

import os
import asyncio
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from ingestion import KnowledgeBase
from kg_graph import KnowledgeGraph, KG_ENABLED
from web_search import search_official_sites

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────────
KB_PATH           = os.getenv("KB_STORAGE_PATH", "./knowledge_base")
TOP_K             = int(os.getenv("TOP_K_RESULTS", 5))
MIN_SCORE         = float(os.getenv("MIN_RELEVANCE_SCORE", "0.25"))
ENABLE_WEB_SEARCH = bool(os.getenv("TAVILY_API_KEY", ""))

kb: KnowledgeBase | None = None
kg: KnowledgeGraph | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global kb, kg

    # ── Pinecone KB ──────────────────────────────────────────────────────────
    logger.info(f"Loading Pinecone knowledge base from {KB_PATH} …")
    kb = KnowledgeBase(storage_path=KB_PATH)
    docs = kb.list_documents()
    logger.info(f"Pinecone KB ready — {kb.index_total} vectors, {len(docs)} documents")

    # ── Knowledge Graph ──────────────────────────────────────────────────────
    kg = KnowledgeGraph()
    await kg.init()

    if ENABLE_WEB_SEARCH:
        logger.info("Web search fallback: ENABLED (Tavily)")
    else:
        logger.info("Web search fallback: DISABLED (set TAVILY_API_KEY to enable)")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    if kg:
        await kg.close()
    logger.info("RAG+KG service shut down")


app = FastAPI(title="Trane KB RAG+KG Service", version="2.0.0", lifespan=lifespan)

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
        "status":      "ok",
        "vectors":     kb.index_total if kb else 0,
        "documents":   len(kb.list_documents()) if kb else 0,
        "embed_mode":  "azure/text-embedding-3-small" if USE_AZURE_EMBED else "pinecone/multilingual-e5-large",
        "kg_enabled":  kg.ready if kg else False,
        "web_search":  ENABLE_WEB_SEARCH,
    }


# ── Ingest: file upload ─────────────────────────────────────────────────────────
@app.post("/ingest")
async def ingest_file(
    background_tasks: BackgroundTasks,
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
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error(f"Ingest error: {e}")
        raise HTTPException(500, "Pinecone ingestion failed — check server logs")

    # KG ingestion runs in background — HTTP response returns immediately
    chunks = result.pop("_chunks", [])
    if kg and kg.ready and chunks:
        background_tasks.add_task(
            kg.ingest_chunks, result["doc_id"], file.filename, chunks
        )
        result["kg_status"] = "extracting entities in background"
    else:
        result["kg_status"] = "kg disabled" if not KG_ENABLED else "kg not ready"

    return {"success": True, **result}


# ── Ingest: URL ─────────────────────────────────────────────────────────────────
class UrlIngestRequest(BaseModel):
    url: str
    category: str = "general"


@app.post("/ingest/url")
async def ingest_url(req: UrlIngestRequest, background_tasks: BackgroundTasks):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    try:
        result = kb.ingest_url(req.url, req.category)
    except Exception as e:
        logger.error(f"URL ingest error: {e}")
        raise HTTPException(500, str(e))

    chunks = result.pop("_chunks", [])
    if kg and kg.ready and chunks:
        background_tasks.add_task(
            kg.ingest_chunks, result["doc_id"], req.url, chunks
        )
        result["kg_status"] = "extracting entities in background"

    return {"success": True, **result}


# ── Query — dual search: Pinecone + KG, merged ─────────────────────────────────
class QueryRequest(BaseModel):
    question: str
    top_k: int = TOP_K


@app.post("/query")
async def query(req: QueryRequest):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    if not req.question.strip():
        raise HTTPException(422, "question is required")

    # Run Pinecone vector search + KG graph search in parallel
    pinecone_task = asyncio.to_thread(kb.query, req.question, req.top_k)
    kg_task       = kg.search(req.question) if (kg and kg.ready) else asyncio.sleep(0, result=[])

    raw_vector, kg_facts = await asyncio.gather(pinecone_task, kg_task)

    # ── Filter Pinecone results by confidence ─────────────────────────────────
    vector_results = [r for r in raw_vector if r["score"] >= MIN_SCORE]

    # ── Build merged context ──────────────────────────────────────────────────
    parts = []

    if vector_results:
        vector_block = "\n\n---\n\n".join(
            f"[Document: {r['filename']} | Category: {r['category']}]\n{r['text']}"
            for r in vector_results
        )
        parts.append(f"## DOCUMENT KNOWLEDGE\n{vector_block}")

    if kg_facts:
        kg_block = "\n".join(f"• {f['fact']}" for f in kg_facts)
        parts.append(f"## PRODUCT RELATIONSHIPS & FACTS (Knowledge Graph)\n{kg_block}")

    if parts:
        context = "\n\n".join(parts)
        return {
            "context":  context,
            "chunks":   vector_results,
            "kg_facts": kg_facts,
            "total":    len(vector_results) + len(kg_facts),
            "source":   _source_label(vector_results, kg_facts),
            "grounded": True,
        }

    # ── Web search fallback ───────────────────────────────────────────────────
    if ENABLE_WEB_SEARCH:
        logger.info(f"No KB/KG results for '{req.question[:50]}' — trying web search")
        web_results = await search_official_sites(req.question)
        if web_results:
            context = "\n\n---\n\n".join(
                f"[Source: {r['url']}]\n{r['content']}" for r in web_results
            )
            return {
                "context":  context,
                "chunks":   web_results,
                "kg_facts": [],
                "total":    len(web_results),
                "source":   "web_search",
                "grounded": True,
            }

    # ── Nothing found — no hallucination ─────────────────────────────────────
    logger.info(f"No grounded answer found for: '{req.question[:60]}'")
    return {
        "context":  "",
        "chunks":   [],
        "kg_facts": [],
        "total":    0,
        "source":   "none",
        "grounded": False,
    }


def _source_label(vector_results, kg_facts):
    if vector_results and kg_facts:
        return "knowledge_base+knowledge_graph"
    if kg_facts:
        return "knowledge_graph"
    return "knowledge_base"


# ── List documents ──────────────────────────────────────────────────────────────
@app.get("/documents")
def list_documents():
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    return {"documents": kb.list_documents()}


# ── Delete document ─────────────────────────────────────────────────────────────
@app.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, background_tasks: BackgroundTasks):
    if kb is None:
        raise HTTPException(503, "Knowledge base not ready")
    deleted = kb.delete_document(doc_id)
    if not deleted:
        raise HTTPException(404, f"Document {doc_id} not found")

    # Also remove KG episodes for this doc
    if kg and kg.ready:
        background_tasks.add_task(kg.delete_doc, doc_id)

    return {"success": True, "doc_id": doc_id}


# ── Dev run ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
