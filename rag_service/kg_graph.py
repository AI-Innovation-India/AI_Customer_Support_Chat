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
import asyncio
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


# ── No-op cross-encoder ────────────────────────────────────────────────────────
# Graphiti defaults to OpenAIRerankerClient (requires OPENAI_API_KEY).
# When using Azure-only we inject this identity reranker instead.
# Must inherit from CrossEncoderClient — Graphiti uses pydantic isinstance check.
from graphiti_core.cross_encoder.client import CrossEncoderClient as _CrossEncoderBase

class _IdentityCrossEncoder(_CrossEncoderBase):
    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        return [(p, 1.0) for p in passages]


# ── SSL-aware Neo4j driver ─────────────────────────────────────────────────────
# On Windows, Python's SSL store may not trust AuraDB's cert chain.
# neo4j+ssc:// = encrypted TLS but trusts any certificate (skips verification).
# This is the simplest fix for Windows — connection is still encrypted.
def _build_neo4j_driver(uri: str, user: str, password: str):
    """Return a Neo4jDriver using neo4j+ssc:// to bypass Windows SSL cert issues."""
    from neo4j import AsyncGraphDatabase
    from graphiti_core.driver.driver import GraphDriver
    from graphiti_core.driver.neo4j_driver import (
        Neo4jDriver,
        Neo4jEntityNodeOperations, Neo4jEpisodeNodeOperations,
        Neo4jCommunityNodeOperations, Neo4jSagaNodeOperations,
        Neo4jEntityEdgeOperations, Neo4jEpisodicEdgeOperations,
        Neo4jCommunityEdgeOperations, Neo4jHasEpisodeEdgeOperations,
        Neo4jNextEpisodeEdgeOperations, Neo4jSearchOperations,
        Neo4jGraphMaintenanceOperations,
    )

    class _TrustedDriver(Neo4jDriver):
        def __init__(self, uri, user, password, database="neo4j"):
            # Bypass Neo4jDriver.__init__ — call the ABC base instead
            GraphDriver.__init__(self)

            # Convert neo4j+s:// → neo4j+ssc:// (encrypted, trust-all certs)
            # neo4j+s requires system CA store (fails on Windows with AuraDB chain).
            # neo4j+ssc skips cert verification — connection is still TLS encrypted.
            ssc_uri = (
                uri.replace("neo4j+s://", "neo4j+ssc://")
                   .replace("bolt+s://", "bolt+ssc://")
            )
            self.client = AsyncGraphDatabase.driver(
                uri=ssc_uri,
                auth=(user or "", password or ""),
            )
            self._database = database

            # Re-create operation objects (same as Neo4jDriver.__init__)
            self._entity_node_ops    = Neo4jEntityNodeOperations()
            self._episode_node_ops   = Neo4jEpisodeNodeOperations()
            self._community_node_ops = Neo4jCommunityNodeOperations()
            self._saga_node_ops      = Neo4jSagaNodeOperations()
            self._entity_edge_ops    = Neo4jEntityEdgeOperations()
            self._episodic_edge_ops  = Neo4jEpisodicEdgeOperations()
            self._community_edge_ops = Neo4jCommunityEdgeOperations()
            self._has_episode_edge_ops  = Neo4jHasEpisodeEdgeOperations()
            self._next_episode_edge_ops = Neo4jNextEpisodeEdgeOperations()
            self._search_ops         = Neo4jSearchOperations()
            self._graph_ops          = Neo4jGraphMaintenanceOperations()
            self.aoss_client         = None
            # Note: build_indices_and_constraints() is called explicitly
            # in KnowledgeGraph.init() — do NOT schedule it here to avoid
            # running it with wrong credentials before init() validates them.

    return _TrustedDriver(uri, user, password)


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

    graph_driver = _build_neo4j_driver(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)

    g = Graphiti(
        llm_client=llm_client,
        embedder=embedder,
        cross_encoder=_IdentityCrossEncoder(),
        graph_driver=graph_driver,
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
            # build_indices_and_constraints is on the underlying graph driver
            await self._graphiti.driver.build_indices_and_constraints()
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
            async with self._graphiti.driver.client.session() as session:
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
