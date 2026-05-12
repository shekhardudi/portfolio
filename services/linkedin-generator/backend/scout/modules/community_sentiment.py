"""
Community Sentiment — multi-query, subreddit-targeted, HN-aware.

Tools used:
  - Tavily news (rotating bank of 6, pick 3 per run)
  - Tavily news with reddit subreddit include_domains (always 2 queries)
  - HN Algolia API with UNIX timestamp + points filtering

Cache: Tavily calls are wrapped via backend.scout.cache; HN is not (cheap +
freshness-sensitive).
"""

from __future__ import annotations

from typing import Any, Optional

import httpx
from tavily import TavilyClient

from ..cache import cached_call
from ..query_bank import (
    COMMUNITY_SENTIMENT_BANK,
    COMMUNITY_SENTIMENT_SUBREDDIT_QUERIES,
    gap_probe,
    pick_queries,
)
from ..types import MemorySnapshot
from ..url_utils import canonical_url
from .base import BaseScanner, ProgressFn, ScanResult
from .time_utils import days_to_cutoff


class CommunitySentimentScanner(BaseScanner):
    MODULE_ID = "community_sentiment"
    MODULE_LABEL = "Community Sentiment"

    def __init__(self, tavily_key: str):
        self._tavily_key = tavily_key
        self._tavily = TavilyClient(api_key=tavily_key) if tavily_key else None

    # Legacy entry-point — keep working without snapshot/progress.
    def scan(self, days: int) -> ScanResult:
        return self.gather(days=days, snapshot=None, progress=None)

    def gather(
        self,
        days: int,
        snapshot: Optional[MemorySnapshot] = None,
        progress: Optional[ProgressFn] = None,
    ) -> ScanResult:
        days_arg = days if days > 0 else None
        items: list[dict] = []
        queries_used: list[str] = []
        covered_urls = snapshot.covered_urls if snapshot else set()

        def _emit(msg: str, phase: str = "progress", **extra: Any) -> None:
            if progress:
                progress({"module": self.MODULE_ID, "phase": phase, "message": msg, **extra})

        def _on_hit(query: str, age: int) -> None:
            _emit(f"📦 cache · {query[:48]}… (age {age // 60}m)", phase="cache")

        # --- Rotating Tavily news bank (3-of-6) + optional gap probe ---
        if self._tavily:
            news_queries = pick_queries(
                COMMUNITY_SENTIMENT_BANK, snapshot, k=3, module_id=self.MODULE_ID
            )
            probe = gap_probe(snapshot)
            if probe:
                news_queries.append(probe)
            for q in news_queries:
                queries_used.append(q)
                try:
                    resp = cached_call(
                        provider="tavily.news",
                        query=q,
                        days=days_arg or 0,
                        fn=lambda: self._tavily.search(
                            query=q,
                            search_depth="advanced",
                            topic="news",
                            days=days_arg,
                            max_results=5,
                        ),
                        on_hit=lambda age, _q=q: _on_hit(_q, age),
                    )
                    for r in resp.get("results", []):
                        url = canonical_url(r.get("url", ""))
                        if url and url in covered_urls:
                            continue
                        item = {
                            "title": r.get("title", ""),
                            "content": (r.get("content", "") or "")[:300],
                            "url": url or r.get("url", ""),
                            "source": "tavily_news",
                            "query": q,
                        }
                        if r.get("publish_date"):
                            item["published"] = r.get("publish_date")
                        items.append(item)
                except Exception as e:
                    _emit(f"tavily news '{q[:32]}…' failed: {e}", phase="warn")

            # --- Subreddit-targeted Tavily ---
            for q in COMMUNITY_SENTIMENT_SUBREDDIT_QUERIES:
                queries_used.append(q)
                try:
                    resp = cached_call(
                        provider="tavily.reddit",
                        query=q,
                        days=days_arg or 0,
                        fn=lambda: self._tavily.search(
                            query=q,
                            search_depth="advanced",
                            topic="news",
                            include_domains=[
                                "reddit.com/r/MachineLearning",
                                "reddit.com/r/ArtificialIntelligence",
                                "reddit.com/r/GenerativeAI",
                                "reddit.com/r/LocalLLaMA",
                                "reddit.com/r/singularity",
                                "reddit.com/r/AI_Agents"
                            ],
                            days=days_arg,
                            max_results=4,
                        ),
                        on_hit=lambda age, _q=q: _on_hit(_q, age),
                    )
                    for r in resp.get("results", []):
                        url = canonical_url(r.get("url", ""))
                        if url and url in covered_urls:
                            continue
                        item = {
                            "title": r.get("title", ""),
                            "content": (r.get("content", "") or "")[:300],
                            "url": url or r.get("url", ""),
                            "source": "reddit",
                            "query": q,
                        }
                        if r.get("publish_date"):
                            item["published"] = r.get("publish_date")
                        items.append(item)
                except Exception as e:
                    _emit(f"tavily reddit '{q[:32]}…' failed: {e}", phase="warn")

        # --- HN Algolia (no cache) ---
        try:
            params: dict = {
                "query": "OpenAI OR Anthropic OR Google OR DeepMind OR Mistral OR xAI",
                "tags": "story",
                "hitsPerPage": 12,
                "numericFilters": "points>30",
            }
            if days_arg:
                cutoff_ts = int(days_to_cutoff(days_arg).timestamp())
                params["numericFilters"] = f"points>30,created_at_i>{cutoff_ts}"

            resp = httpx.get(
                "https://hn.algolia.com/api/v1/search_by_date",
                params=params,
                timeout=10.0,
            )
            resp.raise_for_status()
            for h in resp.json().get("hits", [])[:8]:
                url = canonical_url(h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}")
                if url and url in covered_urls:
                    continue
                item = {
                    "title": h.get("title", ""),
                    "content": f"{h.get('points', 0)} pts, {h.get('num_comments', 0)} comments",
                    "url": url,
                    "source": "hackernews",
                }
                if h.get("created_at_i"):
                    from datetime import datetime
                    try:
                        item["published"] = datetime.utcfromtimestamp(h.get("created_at_i")).isoformat() + "Z"
                    except (ValueError, TypeError):
                        pass
                items.append(item)
        except Exception as e:
            _emit(f"hn algolia failed: {e}", phase="warn")

        _emit(f"{len(items)} items ({len(queries_used)} queries)", phase="done")
        return ScanResult(
            module_id=self.MODULE_ID,
            module_label=self.MODULE_LABEL,
            items=items,
            queries_used=queries_used,
        )
