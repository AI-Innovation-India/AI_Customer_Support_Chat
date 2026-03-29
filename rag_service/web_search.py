"""
Web search fallback — restricted to official Trane & ThermoKing domains only.
Uses Tavily API (built for RAG — returns clean text, not raw HTML).

If TAVILY_API_KEY is not set, this module returns empty results silently.
The AI is then instructed to say "I don't have that information" instead of guessing.
"""

import os
import logging
import asyncio
import httpx

logger = logging.getLogger(__name__)

TAVILY_KEY    = os.getenv("TAVILY_API_KEY", "")
TAVILY_URL    = "https://api.tavily.com/search"

# Only these domains are trusted — prevents off-topic or misleading results
ALLOWED_DOMAINS = [
    "trane.com",
    "thermoking.com",
    "tranetechnologies.com",
    "tranecds.com",
    "thermo-king.com",
]

MAX_RESULTS   = 4
MAX_CONTENT   = 600   # chars per result — keeps context tight


async def search_official_sites(question: str) -> list[dict]:
    """
    Search trane.com + thermoking.com for an answer.
    Returns list of {url, title, content} dicts, or [] if nothing found.
    """
    if not TAVILY_KEY:
        return []

    payload = {
        "api_key":              TAVILY_KEY,
        "query":                question,
        "search_depth":         "basic",
        "include_domains":      ALLOWED_DOMAINS,
        "max_results":          MAX_RESULTS,
        "include_raw_content":  False,
        "include_answer":       False,
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(TAVILY_URL, json=payload)
            r.raise_for_status()
            data = r.json()

        results = []
        for item in data.get("results", []):
            content = (item.get("content") or "").strip()
            if not content:
                continue
            results.append({
                "url":     item.get("url", ""),
                "title":   item.get("title", ""),
                "content": content[:MAX_CONTENT],
                "score":   item.get("score", 0.0),
            })

        logger.info(f"Web search returned {len(results)} results for: '{question[:50]}'")
        return results

    except httpx.TimeoutException:
        logger.warning("Tavily search timed out")
        return []
    except Exception as e:
        logger.warning(f"Tavily search failed: {e}")
        return []
