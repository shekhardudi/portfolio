"""
Redis cache service with graceful no-op fallback.

When Redis is unavailable the service:
  - Returns None for every get()  -> treated as a cache miss downstream
  - Silently ignores set() calls  -> no caching, but nothing breaks
  - Tracks top queries in a process-local Counter instead of a Redis sorted set

Call get_cache_service() to obtain the process-wide singleton.
"""
import hashlib
import json
import structlog
from collections import Counter
from functools import lru_cache
from typing import Any, Dict, List, Optional

logger = structlog.get_logger(__name__)

_TOP_QUERIES_KEY = "intelli-search:top_queries"

# In-memory fallback counter (per-process) when Redis is not available
_FALLBACK_QUERY_COUNTER: Counter = Counter()


class CacheService:
    def __init__(self, redis_url: str, default_ttl: int = 300):
        self._ttl = default_ttl
        self._client = None
        self._available = False

        try:
            import redis as _redis
            client = _redis.Redis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            client.ping()
            self._client = client
            self._available = True
            logger.info("redis_cache_connected", url=redis_url)
        except Exception as exc:
            logger.warning(
                "redis_unavailable_using_noop_cache",
                error=str(exc),
                hint="Start Redis to enable distributed caching and persistent top-query tracking.",
            )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_available(self) -> bool:
        return self._available

    # ------------------------------------------------------------------
    # Key helpers
    # ------------------------------------------------------------------

    def make_key(self, namespace: str, params: Dict[str, Any]) -> str:
        """Create a deterministic cache key from a namespace + param dict."""
        canonical = json.dumps(params, sort_keys=True, default=str)
        digest = hashlib.sha256(canonical.encode()).hexdigest()[:24]
        return f"intelli-search:{namespace}:{digest}"

    # ------------------------------------------------------------------
    # Core cache operations
    # ------------------------------------------------------------------

    def get(self, key: str) -> Optional[str]:
        """Return cached JSON string, or None on miss / unavailability."""
        if not self._available:
            return None
        try:
            return self._client.get(key)
        except Exception as exc:
            logger.warning("redis_get_error", key=key, error=str(exc))
            return None

    def set(self, key: str, value: str, ttl: Optional[int] = None) -> None:
        """Store a JSON string with an optional TTL (seconds)."""
        if not self._available:
            return
        try:
            self._client.set(key, value, ex=ttl or self._ttl)
        except Exception as exc:
            logger.warning("redis_set_error", key=key, error=str(exc))

    def delete(self, key: str) -> None:
        """Delete a cache entry."""
        if not self._available:
            return
        try:
            self._client.delete(key)
        except Exception as exc:
            logger.warning("redis_delete_error", key=key, error=str(exc))

    # ------------------------------------------------------------------
    # Top-queries analytics
    # ------------------------------------------------------------------

    def track_query(self, query: str) -> None:
        """Increment the query hit count. Falls back to in-process Counter."""
        normalized = query.strip().lower()
        if self._available:
            try:
                self._client.zincrby(_TOP_QUERIES_KEY, 1, normalized)
                return
            except Exception as exc:
                logger.warning("redis_track_query_error", error=str(exc))
        _FALLBACK_QUERY_COUNTER[normalized] += 1

    def get_top_queries(self, n: int = 10) -> List[Dict[str, Any]]:
        """Return the top-N most frequent queries with counts, highest first."""
        if self._available:
            try:
                items = self._client.zrevrange(_TOP_QUERIES_KEY, 0, n - 1, withscores=True)
                return [{"query": q, "count": int(score)} for q, score in items]
            except Exception as exc:
                logger.warning("redis_get_top_queries_error", error=str(exc))
        return [
            {"query": q, "count": c}
            for q, c in _FALLBACK_QUERY_COUNTER.most_common(n)
        ]


@lru_cache(maxsize=1)
def get_cache_service() -> "CacheService":
    """Return the process-wide CacheService singleton."""
    from app.config import get_settings
    settings = get_settings()
    return CacheService(redis_url=settings.REDIS_URL, default_ttl=settings.CACHE_TTL_SECONDS)
