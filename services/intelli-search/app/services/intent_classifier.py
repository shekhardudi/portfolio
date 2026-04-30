"""
Intent Classifier Service - Routes queries to the appropriate search bucket.
Uses GPT-4o-mini with Instructor for deterministic, structured output.
"""
import structlog
import json
from functools import lru_cache
from pathlib import Path
from typing import Optional, Dict, Any
from enum import Enum
from datetime import datetime
import instructor
from openai import OpenAI
import httpx
from pydantic import BaseModel, Field
from app.config import get_settings, get_search_config
from app.utils.cache import BoundedDict
from app.observability import generate_trace_id

logger = structlog.get_logger(__name__)

# Load system prompt from file at module level to fail fast on missing file.
_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "intent_classifier_system.txt"
_SYSTEM_PROMPT: str = _PROMPT_PATH.read_text(encoding="utf-8")


class SearchIntent(str, Enum):
    """Query intent categories for routing"""
    REGULAR = "regular"
    SEMANTIC = "semantic"
    AGENTIC = "agentic"


class QueryIntent(BaseModel):
    """Structured intent output from classifier"""
    category: SearchIntent = Field(
        description="Query routing bucket: 'regular' for exact/name searches, "
        "'semantic' for conceptual/synonym queries, 'agentic' for external data"
    )
    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description="Classification confidence score (0-1)"
    )
    filters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Extracted structured filters: location, industry, year, etc."
    )
    search_query: str = Field(
        description="Optimized query string for OpenSearch"
    )
    needs_external_data: bool = Field(
        default=False,
        description="True if query requires external APIs (news, funding, etc.)"
    )
    external_data_type: Optional[str] = Field(
        default=None,
        description="Type of external data needed: 'news', 'funding', 'events', etc."
    )
    field_boosts: Dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Per-field boost multipliers for the OpenSearch multi_match clause. "
            "Only populated for SEMANTIC queries. "
            "Keys: name, domain, industry, searchable_text, locality. "
            "Values: boost multiplier (e.g. 3.0 = 3x weight). "
            "Empty dict means fall back to hardcoded defaults."
        )
    )
    reasoning: str = Field(
        description="Brief reasoning for the classification decision"
    )
    named_companies: list[str] = Field(
        default_factory=list,
        description=(
            "Specific named companies referenced in the query that warrant "
            "per-company enrichment (e.g. LinkedIn lookup). Only populate "
            "for AGENTIC queries that mention concrete company names "
            "(quoted strings, legal suffixes like 'Inc/Ltd/GmbH', or known "
            "brands such as 'OpenAI', 'Stripe'). Empty list otherwise."
        ),
    )


class IntentClassifier:
    """
    Classifies search queries into buckets using GPT-4o-mini + Instructor.
    Ensures deterministic, structured routing decisions.
    """
    
    def __init__(self):
        """Initialize classifier with Instructor-patched OpenAI client"""
        self.settings = get_settings()
        
        # Create base OpenAI client with a short pool idle timeout so
        # connections don't go stale during long periods without searches.
        self.client = OpenAI(
            api_key=self.settings.OPENAI_API_KEY,
            http_client=httpx.Client(
                limits=httpx.Limits(keepalive_expiry=30),
                timeout=httpx.Timeout(60.0, connect=5.0),
            ),
        )
        
        # Patch with Instructor for structured outputs
        self.client = instructor.from_openai(self.client)
        self.model = self.settings.OPENAI_MINI_MODEL
        self.confidence_threshold = self.settings.CLASSIFIER_CONFIDENCE_THRESHOLD
        self.timeout = self.settings.CLASSIFIER_TIMEOUT
        
        logger.info(
            "intent_classifier_initialized",
            model=self.model,
            confidence_threshold=self.confidence_threshold
        )
        self._classify_cache: BoundedDict = BoundedDict(
            maxsize=get_search_config().get("cache", {}).get("classifier_maxsize", 256)
        )
        self._cache_maxsize = self._classify_cache._maxsize
    
    def classify(self, query: str, trace_id: Optional[str] = None) -> QueryIntent:
        """
        Classify a query and route to appropriate search bucket.
        
        Args:
            query: User's search query
            trace_id: Optional trace ID for observability
        
        Returns:
            QueryIntent with category, filters, and reasoning
        """
        if not query or not query.strip():
            logger.warning("empty_query_received", trace_id=trace_id)
            return self._empty_query_intent()

        cache_key = query.strip().lower()
        if cache_key in self._classify_cache:
            logger.info("classification_cache_hit", query=query[:100])
            return self._classify_cache[cache_key]

        trace_id = trace_id or generate_trace_id()

        system_prompt = _SYSTEM_PROMPT

        user_prompt = f"""Classify this query: "{query}"

Return a JSON object with ALL of these keys:
- category: regular|semantic|agentic
- confidence: 0.0-1.0
- search_query: the cleaned query string with location/filter words stripped (e.g. "tech companies" not "tech companies in united states")
- filters: {{
    "location_country": "...",   // full English country name ("United States", "Germany") or null
    "location_state": "...",     // state/province or null
    "location_city": "...",      // city or null
    "industry": "...",           // canonical industry label or null
    "year_from": null,           // integer year or null
    "year_to": null,             // integer year or null
    "size_range": null           // MUST be EXACTLY one of these strings (verbatim) or null:
                                 // "1-10", "11-50", "51-200", "201-500",
                                 // "501-1000", "1001-5000", "5001-10000", "10001+"
                                 // Map concepts: startups/micro→"1-10", small→"11-50",
                                 // growing→"51-200", mid-size→"201-500",
                                 // large→"1001-5000", enterprise/Fortune500→"10001+"
  }}
- needs_external_data: true/false
- external_data_type: null or "news"|"funding"|"events"
- field_boosts: {{"name": 1.0, "domain": 1.0, "industry": 1.0, "searchable_text": 1.0, "locality": 1.0}}  // adjust values for SEMANTIC; return empty {{}} for REGULAR/AGENTIC
- named_companies: []  // For AGENTIC queries only: list of specific companies named in the query (e.g. ["OpenAI", "Stripe Inc"]); empty [] otherwise
- reasoning: 1-2 sentence explanation"""

        try:
            import time as _time
            _t0 = _time.perf_counter()
            response = self.client.chat.completions.create(
                model=self.model,
                max_tokens=1000,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_model=QueryIntent,
                timeout=self.timeout
            )
            _llm_ms = int((_time.perf_counter() - _t0) * 1000)

            # Record LLM metrics (non-fatal)
            try:
                from app.observability.metrics import get_search_metrics
                _m = get_search_metrics()
                _attrs = {"model": self.model, "status": "success"}
                _m["llm_calls_total"].add(1, _attrs)
                _m["llm_latency_ms"].record(_llm_ms, _attrs)
            except Exception:
                pass
            
            logger.info(
                "query_classified",
                trace_id=trace_id,
                query=query[:100],
                category=response.category.value,
                confidence=response.confidence,
                reasoning=response.reasoning
            )

            self._classify_cache[cache_key] = response

            return response
            
        except Exception as e:
            logger.error(
                "classification_failed",
                trace_id=trace_id,
                query=query[:100],
                error=str(e)
            )
            try:
                from app.observability.metrics import get_search_metrics
                get_search_metrics()["llm_calls_total"].add(
                    1, {"model": self.model, "status": "error"}
                )
            except Exception:
                pass
            # Fallback: return semantic for safety
            return self._semantic_fallback_intent(query)

    async def aclassify(self, query: str, trace_id: Optional[str] = None) -> QueryIntent:
        """Async wrapper around :meth:`classify`.

        Runs the (cache-aware) sync classify in a worker thread so the event
        loop is never blocked by an OpenAI HTTP call. The Instructor sync
        client is preserved as the source of truth — wrapping with
        ``asyncio.to_thread`` keeps the cache + retry logic intact.
        """
        import asyncio as _asyncio
        return await _asyncio.to_thread(self.classify, query, trace_id)

    def _empty_query_intent(self) -> QueryIntent:
        """Return intent for empty/None queries"""
        return QueryIntent(
            category=SearchIntent.REGULAR,
            confidence=1.0,
            filters={},
            search_query="",
            needs_external_data=False,
            field_boosts={},
            reasoning="Empty query - returning empty intent"
        )
    
    def _semantic_fallback_intent(self, query: str) -> QueryIntent:
        """Fallback for classification errors - default to semantic, use hardcoded defaults"""
        return QueryIntent(
            category=SearchIntent.SEMANTIC,
            confidence=0.5,
            filters={},
            search_query=query,
            needs_external_data=False,
            field_boosts={},  # empty → SemanticSearchStrategy will apply _DEFAULT_FIELD_BOOSTS
            reasoning="Classification error - defaulting to semantic search"
        )
    



# ============================================================================
# Singleton Pattern - Lazy Initialization
# ============================================================================

@lru_cache(maxsize=1)
def get_intent_classifier() -> IntentClassifier:
    """
    Get or create intent classifier instance (singleton).
    Used as a dependency in FastAPI endpoints.
    """
    return IntentClassifier()
