"""Tiny on-disk JSON cache for Tavily / ArXiv responses.

Key shape: ``sha1(provider | query | days | week_of_year | extra)``.
Value shape: ``{"stored_at": iso8601, "payload": <json>}``.

Used only by free-text-query providers that return the same top-N for the
same inputs within a freshness window. Crawl4ai (frontier_labs already does
URL diff) and HN Algolia (cheap + freshness-sensitive) are intentionally
not wrapped.
"""

from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from backend.core.paths import outputs_dir
from backend.core.settings import get_settings


def cache_dir() -> Path:
    p = outputs_dir() / "scout" / "cache"
    p.mkdir(parents=True, exist_ok=True)
    return p


def week_of_year(now: datetime | None = None) -> int:
    return (now or datetime.now(timezone.utc)).isocalendar().week


def make_key(provider: str, query: str, days: int, *, extra: str = "", week: int | None = None) -> str:
    week_val = week if week is not None else week_of_year()
    raw = "|".join([provider, query.strip(), str(days), str(week_val), extra])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _path_for(key: str) -> Path:
    return cache_dir() / f"{key}.json"


def load(key: str, *, ttl_seconds: int) -> Optional[Any]:
    """Return cached payload if still within TTL, else None."""
    s = get_settings()
    if not getattr(s, "scout_cache_enabled", True):
        return None
    p = _path_for(key)
    if not p.exists():
        return None
    try:
        if (time.time() - p.stat().st_mtime) > ttl_seconds:
            return None
        return json.loads(p.read_text())["payload"]
    except Exception:
        return None


def store(key: str, payload: Any) -> None:
    s = get_settings()
    if not getattr(s, "scout_cache_enabled", True):
        return
    p = _path_for(key)
    try:
        p.write_text(json.dumps({
            "stored_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload,
        }))
    except Exception:
        # Cache failures must never break the call site.
        return


def cached_call(
    provider: str,
    query: str,
    days: int,
    fn: Callable[[], Any],
    *,
    extra: str = "",
    on_hit: Optional[Callable[[int], None]] = None,
) -> Any:
    """Run ``fn()`` once per (provider, query, days, week) within TTL.

    ``on_hit`` receives the age in seconds when a hit is served (useful
    for progress callbacks).
    """
    s = get_settings()
    ttl_seconds = int(getattr(s, "scout_cache_ttl_hours", 24)) * 3600
    key = make_key(provider, query, days)
    cached = load(key, ttl_seconds=ttl_seconds)
    if cached is not None:
        if on_hit:
            try:
                age = int(time.time() - _path_for(key).stat().st_mtime)
                on_hit(age)
            except Exception:
                pass
        return cached
    payload = fn()
    store(key, payload)
    return payload


__all__ = ["cache_dir", "cached_call", "load", "make_key", "store", "week_of_year"]
