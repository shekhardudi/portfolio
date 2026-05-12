"""Hardcoded query banks + deterministic rotation.

Each Tavily-backed module gets a bank of queries; ``pick_queries`` chooses
``k`` of them based on ``hash(week_of_year, rotation_cursor) % len(bank)``,
then optionally appends a memory-aware "gap probe" query when the previous
briefing's `gaps` list is non-empty.

Rationale: see backend/scout/uplift.md — "Hardcoded vs LLM-Generated Queries".
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from .types import MemorySnapshot


COMMUNITY_SENTIMENT_BANK = [
    "enterprise AI adoption challenges",
    "enterprise AI security concerns",
    "agentic loop token burn cost failure report",
    "AI model benchmark beats SOTA leaderboard results",
    "limitations of current LLMs",
    "AI breakthrough production use cases",
    "Ai startups funsing rounds notable news",
    "AI regulation policy news",
    "AI ethics controversy",
    "AI impact on jobs news",
]


EXPERT_SYNTHESIS_BANK = [
    "AI breakthrough notable result this week",
    "AI research paper analysis explainer",
    "weekly AI digest top stories",
    "AI evaluation methodology critique",
]


# Community-sentiment subreddit queries — always run.
COMMUNITY_SENTIMENT_SUBREDDIT_QUERIES = [
    "latest news in ai",
    "what are people worried about in ai",
    "AI hype vs reality 2026",
    "AI tool launched this week",
    "impact of AI agents on jobs"
]


# ArXiv queries — small bank, always run all (free, dedupe is cheap).
#
# Each query pins an arxiv category (cs.CL, cs.LG, cs.AI, cs.CV) so we don't
# match unrelated physics/math papers that happen to mention the keywords.
# `ti:` searches the title field directly — far less noise than the default
# `all:` which scans abstracts + comments + metadata.
TECHNICAL_DEEP_DIVE_QUERIES = [
    'cat:cs.CL AND (ti:"large language model" OR ti:LLM OR ti:pretraining)',
    'cat:cs.AI AND (ti:agent OR ti:"tool use" OR ti:"multi-agent")',
    'cat:cs.CV AND (ti:multimodal OR ti:"vision language" OR ti:VLM)',
    'cat:cs.LG AND (ti:reasoning OR ti:"chain of thought" OR ti:"scaling laws")',
    'cat:cs.AI AND (ti:alignment OR ti:RLHF OR ti:"AI safety")',
]


def _hash_pick(seed: str, n: int) -> int:
    """Deterministic 0..n-1 from a seed string."""
    if n <= 0:
        return 0
    h = hashlib.sha1(seed.encode("utf-8")).hexdigest()
    return int(h, 16) % n


def _week_of_year(now: datetime | None = None) -> int:
    return (now or datetime.now(timezone.utc)).isocalendar().week


def pick_queries(
    bank: list[str],
    snapshot: MemorySnapshot | None,
    k: int,
    *,
    module_id: str = "",
    now: datetime | None = None,
) -> list[str]:
    """Pick ``k`` queries from ``bank`` deterministically.

    Selection is driven by ``hash(module_id, week_of_year, cursor)``; consecutive
    runs in the same week with an advancing cursor pick a different rotating
    window, attacking the "same content twice" failure mode.
    """
    if not bank:
        return []
    k = max(1, min(k, len(bank)))
    cursor = int((snapshot.rotation_cursor if snapshot else 0) or 0)
    week = _week_of_year(now)
    start = _hash_pick(f"{module_id}|{week}|{cursor}", len(bank))
    return [bank[(start + i) % len(bank)] for i in range(k)]


def gap_probe(snapshot: MemorySnapshot | None, max_words: int = 6) -> str | None:
    """Build a single 'follow up on a recent gap' query, or None."""
    if not snapshot or not snapshot.recent_gaps:
        return None
    gap = (snapshot.recent_gaps[0] or "").strip()
    if not gap:
        return None
    words = gap.split()
    if len(words) > max_words:
        gap = " ".join(words[:max_words])
    return f'"{gap}" recent'


__all__ = [
    "COMMUNITY_SENTIMENT_BANK",
    "COMMUNITY_SENTIMENT_SUBREDDIT_QUERIES",
    "EXPERT_SYNTHESIS_BANK",
    "TECHNICAL_DEEP_DIVE_QUERIES",
    "gap_probe",
    "pick_queries",
]
