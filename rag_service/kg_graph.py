"""
Knowledge Graph pipeline — Graphiti + Neo4j AuraDB.

Runs alongside Pinecone (vector search). Both results are merged
before answering the customer, giving Yazhi true product intelligence:
  - Pinecone  → finds similar text chunks (what the document says)
  - Neo4j KG  → traverses entity relationships (what things mean + connect to)

Embedding + LLM:
  - If AZURE_ENDPOINT + AZURE_KEY + AZURE_DEPLOY + AZURE_EMBED_DEPLOYMENT set → Azure OpenAI
  - Otherwise → plain OpenAI (OPENAI_API_KEY)

Group ID strategy:
  Every document gets its own group_id = doc_id.
  Global KB search uses group_ids=None (searches all).
"""

import os
import re
import logging
from datetime import datetime, timezone

# ── Prompt injection patterns — applied to every chunk before KG ingest ────────
# Prevents adversarial content in uploaded PDFs from hijacking the LLM extraction
_INJECTION_PATTERNS = [
    re.compile(r'ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?', re.I),
    re.compile(r'disregard\s+(all\s+)?(previous|prior|your)\s+instructions?', re.I),
    re.compile(r'you\s+are\s+now\s+(a\s+)?(different|unrestricted|free|DAN)', re.I),
    re.compile(r'\bDAN\b'),
    re.compile(r'jailbreak', re.I),
    re.compile(r'reveal\s+(your\s+)?(system\s+prompt|api\s+key|instructions?)', re.I),
    re.compile(r'override\s+(your\s+)?(instructions?|system|prompt)', re.I),
    re.compile(r'forget\s+(everything|all|your\s+instructions?)', re.I),
    re.compile(r'act\s+as\s+(if\s+you\s+(are|were)\s+)?(?:DAN|an?\s+unrestricted)', re.I),
]

def _is_safe_chunk(text: str) -> bool:
    """Return False if the chunk contains prompt injection patterns."""
    return not any(p.search(text) for p in _INJECTION_PATTERNS)

logger = logging.getLogger(__name__)

NEO4J_URI      = os.getenv("NEO4J_URI", "")
NEO4J_USER     = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")

AZURE_ENDPOINT        = os.getenv("AZURE_ENDPOINT", "")
AZURE_KEY             = os.getenv("AZURE_KEY", "")
AZURE_API_VERSION     = os.getenv("AZURE_API_VERSION", "2024-08-01-preview")
AZURE_DEPLOY          = os.getenv("AZURE_DEPLOYMENT", "")          # chat model
AZURE_EMBED_DEPLOY    = os.getenv("AZURE_EMBED_DEPLOYMENT", "text-embedding-3-small")
OPENAI_API_KEY        = os.getenv("OPENAI_API_KEY", "")

KG_ENABLED = bool(NEO4J_URI and NEO4J_PASSWORD)


def _build_graphiti():
    """Construct and return a Graphiti instance. Called once at startup."""
    if not KG_ENABLED:
        return None

    from graphiti_core import Graphiti
    from graphiti_core.llm_client import LLMConfig
    from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig

    use_azure = bool(AZURE_ENDPOINT and AZURE_KEY)

    if use_azure:
        from openai import AsyncAzureOpenAI
        from graphiti_core.llm_client.azure_openai_client import AzureOpenAILLMClient

        azure_client = AsyncAzureOpenAI(
            azure_endpoint=AZURE_ENDPOINT,
            api_key=AZURE_KEY,
            api_version=AZURE_API_VERSION,
        )
        llm_client = AzureOpenAILLMClient(
            azure_client=azure_client,
            config=LLMConfig(
                model=AZURE_DEPLOY or "gpt-4o",
                small_model=AZURE_DEPLOY or "gpt-4o",
            ),
        )
        embedder = OpenAIEmbedder(
            config=OpenAIEmbedderConfig(embedding_model=AZURE_EMBED_DEPLOY),
            client=azure_client,
        )
        logger.info(f"KG LLM: Azure OpenAI ({AZURE_DEPLOY})")
    else:
        from openai import AsyncOpenAI
        from graphiti_core.llm_client.openai_client import OpenAIClient

        oai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        llm_client = OpenAIClient(
            config=LLMConfig(model="gpt-4o-mini", small_model="gpt-4o-mini"),
            client=oai_client,
        )
        embedder = OpenAIEmbedder(
            config=OpenAIEmbedderConfig(embedding_model="text-embedding-3-small"),
            client=oai_client,
        )
        logger.info("KG LLM: OpenAI gpt-4o-mini")

    g = Graphiti(
        uri=NEO4J_URI,
        user=NEO4J_USER,
        password=NEO4J_PASSWORD,
        llm_client=llm_client,
        embedder=embedder,
    )
    return g


class KnowledgeGraph:
    """Wraps Graphiti for async ingest + search."""

    def __init__(self):
        self._graphiti = None
        self.ready = False

    async def init(self):
        """Async startup — call once from FastAPI lifespan."""
        if not KG_ENABLED:
            logger.info("KG disabled — set NEO4J_URI + NEO4J_PASSWORD in .env to enable")
            return

        try:
            self._graphiti = _build_graphiti()
            await self._graphiti.build_indices_and_constraints()
            self.ready = True
            logger.info(f"KG ready — Neo4j AuraDB at {NEO4J_URI[:40]}…")
        except Exception as e:
            import traceback
            logger.error(f"KG init failed — KG search disabled")
            logger.error(traceback.format_exc())
            self.ready = False

    async def close(self):
        if self._graphiti:
            await self._graphiti.close()

    # ── Ingest ────────────────────────────────────────────────────────────────

    async def ingest_chunks(self, doc_id: str, filename: str, chunks: list[str]):
        """
        Add document chunks to the knowledge graph.
        Each chunk becomes an Episode → Graphiti extracts entities + relationships.
        This runs AFTER Pinecone ingest so Pinecone is always available even
        if KG extraction is slow.
        """
        if not self.ready:
            return

        safe_chunks = [c for c in chunks if _is_safe_chunk(c)]
        skipped = len(chunks) - len(safe_chunks)
        if skipped:
            logger.warning(f"KG: skipped {skipped} chunks from '{filename}' — prompt injection detected")

        logger.info(f"KG: ingesting {len(safe_chunks)} chunks from '{filename}' …")
        from graphiti_core.nodes import EpisodeType

        for i, chunk in enumerate(safe_chunks):
            try:
                await self._graphiti.add_episode(
                    name=f"{doc_id}#{i}",
                    episode_body=chunk,
                    source_description=f"Document: {filename}, chunk {i + 1} of {len(safe_chunks)}",
                    reference_time=datetime.now(timezone.utc),
                    source=EpisodeType.text,
                    group_id=doc_id,
                )
            except Exception as e:
                logger.warning(f"KG: chunk {i} of '{filename}' failed: {e}")

        logger.info(f"KG: finished ingesting '{filename}'")

    async def delete_doc(self, doc_id: str):
        """Remove all graph episodes for a document (best-effort)."""
        if not self.ready:
            return
        try:
            # Graphiti doesn't have a bulk delete by group_id yet —
            # delete via raw Cypher on the Neo4j driver
            async with self._graphiti.driver.session() as session:
                await session.run(
                    "MATCH (e:Episodic {group_id: $gid}) DETACH DELETE e",
                    gid=doc_id,
                )
            logger.info(f"KG: deleted episodes for doc {doc_id}")
        except Exception as e:
            logger.warning(f"KG: delete failed for {doc_id}: {e}")

    # ── Search ────────────────────────────────────────────────────────────────

    async def search(self, question: str, num_results: int = 8) -> list[dict]:
        """
        Semantic + graph traversal search across all documents.
        Returns list of {fact, source} dicts.
        """
        if not self.ready:
            return []

        try:
            results = await self._graphiti.search(
                query=question,
                num_results=num_results,
            )
            facts = []
            seen = set()
            for r in results:
                fact = getattr(r, "fact", "") or ""
                if fact and fact not in seen:
                    seen.add(fact)
                    facts.append({
                        "fact":   fact,
                        "source": "knowledge_graph",
                    })
            return facts
        except Exception as e:
            logger.warning(f"KG search failed: {e}")
            return []
