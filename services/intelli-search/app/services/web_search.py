"""
Pluggable web-search provider protocol.

The agentic pipeline talks to one provider at a time via :class:`WebSearchProvider`.
Concrete implementations:

  * :class:`app.services.tavily_client.TavilyClient`  — default
  * :class:`app.services.serpapi_client.SerpApiClient` — Google AI Mode

Both return Tavily-shaped JSON (``{"results": [{title, url, content,
published_date, ...}, ...]}``) so existing parsers in the pipeline keep
working without per-provider branching.
"""
from __future__ import annotations

from typing import Any, Optional, Protocol, runtime_checkable


@runtime_checkable
class WebSearchProvider(Protocol):
    """Structural type for any web-search backend used by AgenticPipeline."""

    @property
    def enabled(self) -> bool:
        """True when the provider has credentials and is usable."""
        ...

    async def asearch(
        self,
        query: str,
        *,
        max_results: Optional[int] = None,
        include_raw_content: bool = False,
    ) -> dict[str, Any]:
        """Run a search. Return a ``{"results": [...]}`` dict (empty on failure)."""
        ...
