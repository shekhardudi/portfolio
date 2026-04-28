"""
Search Strategy Pattern - Abstract base and implementations.
Allows different search backends to be plugged in based on query intent.
"""
import asyncio
import re
import structlog
import time
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Literal, Optional, TYPE_CHECKING
from pydantic import field_validator
from pydantic import BaseModel
from opensearchpy.exceptions import ConnectionTimeout
from app.config import get_settings, get_search_config

if TYPE_CHECKING:
    from app.services.intent_classifier import QueryIntent

logger = structlog.get_logger(__name__)

# Canonical set of event types — kept in sync with CompanyEvent.event_type in
# agent_service.py so that type mismatches are caught at the Pydantic boundary.
_VALID_EVENT_TYPES = frozenset({
    "funding", "acquisition", "ipo", "merger", "partnership",
    "product_launch", "expansion", "layoffs", "other",
})


class EventData(BaseModel):
    """Structured event data attached to agentic search results."""
    event_type: str = "other"
    amount: Optional[str] = None
    round: Optional[str] = None
    date: Optional[str] = None
    summary: Optional[str] = None
    source_url: Optional[str] = None

    model_config = {"extra": "ignore", "coerce_numbers_to_str": True}

    @field_validator("event_type", mode="before")
    @classmethod
    def _normalise_event_type(cls, v: str) -> str:
        """Coerce unknown event types to 'other' so the field stays consistent."""
        return v if v in _VALID_EVENT_TYPES else "other"


class SearchResult(BaseModel):
    """Unified search result across all strategies"""
    company_id: str
    company_name: str
    domain: Optional[str] = ""
    industry: Optional[str] = ""
    country: Optional[str] = ""
    locality: Optional[str] = ""
    relevance_score: float
    search_method: str  # 'regular', 'semantic', 'agentic'
    matching_reason: Optional[str] = None
    ranking_source: Optional[str] = None  # 'bm25', 'knn', 'hybrid', 'tool'
    year_founded: Optional[int] = None
    size_range: Optional[str] = None
    current_employee_estimate: Optional[int] = None
    event_data: Optional[EventData] = None
    linkedin_profile: Optional[Dict[str, Any]] = None


class SearchContext(BaseModel):
    """Context passed through the search pipeline"""
    query: str
    filters: Dict[str, Any]
    optimized_query: str
    trace_id: str
    confidence: float
    limit: int = 20
    page: int = 1
    include_reasoning: bool = True
    field_boosts: Optional[Dict[str, float]] = None  # LLM-extracted per-field boost multipliers (semantic only)


class SearchStrategy(ABC):
    """
    Abstract base class for search strategies.
    Implements Strategy Pattern for pluggable search implementations.
    """
    
    @abstractmethod
    def search(self, context: SearchContext) -> tuple[List[SearchResult], Dict[str, Any]]:
        """
        Execute search with this strategy.
        
        Args:
            context: SearchContext with query, filters, trace_id, etc.
        
        Returns:
            Tuple of (results, metadata)
            - results: List of SearchResult objects
            - metadata: Dict with execution details (time, score range, etc.)
        """
        pass
    
    @abstractmethod
    def get_strategy_type(self) -> str:
        """Return strategy type identifier"""
        pass

    def _get_score_range(self, results: List[SearchResult]) -> Dict[str, float]:
        """Calculate score range for metadata"""
        if not results:
            return {"min": 0, "max": 0}
        scores = [r.relevance_score for r in results]
        return {"min": min(scores), "max": max(scores)}

    @staticmethod
    def _boosts_to_fields(boosts: Dict[str, float]) -> List[str]:
        """Convert a boost dict to OpenSearch fields list format.
        Fields with boost 1.0 are emitted without a suffix (cleaner query).
        """
        return [f if b == 1.0 else f"{f}^{b:g}" for f, b in boosts.items()]

    @staticmethod
    def _build_filters(filters: Dict[str, Any]) -> List[Dict]:
        """
        Shared helper: convert the unified filters dict into OpenSearch filter clauses.
        Handles both new keys (location_country / location_state / location_city)
        and legacy key (location) for backward compatibility.
        """
        clauses: List[Dict] = []
        if not filters:
            return clauses

        # Location filters
        if country := filters.get("location_country"):
            clauses.append({
                "bool": {
                    "should": [
                        {"term": {"country": country.lower()}},
                        {"term": {"country_tags": country.lower()}},
                    ],
                    "minimum_should_match": 1,
                }
            })
        if state := filters.get("location_state"):
            clauses.append({
                "bool": {
                    "should": [
                        {"match_phrase": {"locality": state}},
                        {"match": {"country": state.lower()}},   # handles city-state = country (e.g. Singapore)
                    ],
                    "minimum_should_match": 1,
                }
            })
        if city := filters.get("location_city"):
            clauses.append({"match_phrase": {"locality": city}})
        # Legacy 'location' key – match against country/state/city as a best-effort
        if loc := filters.get("location"):
            clauses.append({
                "multi_match": {
                    "query": loc,
                    "fields": ["country", "state", "city", "locality"],
                }
            })

        # Industry filter — handles both a list (from UI multi-select) and a single string
        # (from the LLM classifier).  For a list, build one should-clause per industry
        # and wrap them in an outer should so any match is sufficient.
        industries: List[str] = filters.get("industries") or []
        if not industries and filters.get("industry"):
            industries = [filters["industry"]]  # normalise single string to list
        if industries:
            per_industry = [
                {
                    "bool": {
                        "should": [
                            {"match": {"industry": {"query": ind, "fuzziness": "AUTO"}}},
                            {"term": {"industry_tags": ind.lower()}},
                            {"match": {"searchable_text": ind}},
                        ],
                        "minimum_should_match": 1,
                    }
                }
                for ind in industries
            ]
            if len(per_industry) == 1:
                clauses.append(per_industry[0])
            else:
                clauses.append({"bool": {"should": per_industry, "minimum_should_match": 1}})

        # Year filters
        year_range: Dict[str, Any] = {}
        if year_from := filters.get("year_from"):
            year_range["gte"] = year_from
        if year_to := filters.get("year_to"):
            year_range["lte"] = year_to
        if year := filters.get("year"):
            year_range["gte"] = year
            year_range["lte"] = year
        if year_range:
            clauses.append({"range": {"year_founded": year_range}})

        # Size filter
        if size := filters.get("size_range"):
            clauses.append({"term": {"size_range": size}})

        if clauses:
            logger.info(
                "opensearch_filter_clauses_built",
                num_clauses=len(clauses),
                filter_keys=[k for k in filters.keys() if filters.get(k)],
            )

        return clauses


class RegularSearchStrategy(SearchStrategy):
    """
    Bucket 1: Fast Path - Lexical (BM25) search for exact matches.
    Best for: Specific names, acronyms, structured queries.
    """
    
    def __init__(self, opensearch_service):
        """Initialize with OpenSearch service dependency"""
        self.opensearch = opensearch_service
        self.strategy_type = "regular"
    
    def search(self, context: SearchContext) -> tuple[List[SearchResult], Dict[str, Any]]:
        """
        Execute BM25 lexical search on OpenSearch.
        """
        start_time = time.time()
        
        logger.info(
            "regular_search_started",
            trace_id=context.trace_id,
            query=context.query[:100]
        )
        
        # Build BM25 query
        query_body = self._build_bm25_query(context)
        
        try:
            # Execute search
            response = self.opensearch.search(
                index=get_settings().OPENSEARCH_INDEX_NAME,
                query=query_body["query"],
                size=context.limit,
                from_=(context.page - 1) * context.limit
            )
            
            # Process results
            results = self._process_results(response, context)
            
            execution_time = time.time() - start_time
            metadata = {
                "strategy": self.strategy_type,
                "total_hits": response.get("hits", {}).get("total", {}).get("value", 0),
                "returned": len(results),
                "execution_time_ms": int(execution_time * 1000),
                "score_range": self._get_score_range(results)
            }
            
            logger.info(
                "regular_search_completed",
                trace_id=context.trace_id,
                **metadata
            )
            
            return results, metadata
            
        except Exception as e:
            logger.error(
                "regular_search_failed",
                trace_id=context.trace_id,
                error=str(e)
            )
            raise
    
    def _build_bm25_query(self, context: SearchContext) -> Dict[str, Any]:
        """Build OpenSearch BM25 query with field boosts from config.

        Uses a tiered bool query:
        - must: fuzzy multi_match across all fields (recall)
        - should: match_phrase on name with high boost (precision — floats exact name matches to top)
        - should: exact term match on name.keyword for precise name hits
        Wrapped in function_score with log1p employee count boost for popularity.
        """
        cfg = get_search_config().get("field_boosts", {}).get("bm25_regular", {})
        boosts = {
            "name": float(cfg.get("name", 2.0)),
            "domain": float(cfg.get("domain", 2.0)),
            "searchable_text": float(cfg.get("searchable_text", 1.0)),
            "industry": float(cfg.get("industry", 1.0)),
            "locality": float(cfg.get("locality", 1.0)),
        }
        phrase_boost = float(cfg.get("name_phrase_boost", 10.0))
        popularity_factor = float(cfg.get("popularity_boost_factor", 0.2))

        must_clauses = []
        if context.optimized_query:
            must_clauses.append({
                "multi_match": {
                    "query": context.optimized_query,
                    "fields": self._boosts_to_fields(boosts),
                    "type": "best_fields",
                    "operator": "or",
                }
            })

        should_clauses = []
        if context.optimized_query:
            # Phrase match — rewards docs whose name contains the full phrase
            should_clauses.append({
                "match_phrase": {
                    "name": {
                        "query": context.optimized_query,
                        "boost": phrase_boost,
                    }
                }
            })
            # Exact name match — strong boost for docs whose name exactly equals
            # the query (handles "apple" matching "apple" but not "apple inc")
            should_clauses.append({
                "term": {
                    "name.keyword": {
                        "value": context.optimized_query.lower(),
                        "boost": phrase_boost * 1.5,
                    }
                }
            })

        filter_clauses = self._build_filters(context.filters)
        logger.info(
            "search_filters_applied",
            strategy="regular",
            trace_id=context.trace_id,
            raw_filters=context.filters,
            num_filter_clauses=len(filter_clauses),
        )
        bool_query: Dict[str, Any] = {
            "must": must_clauses if must_clauses else [{"match_all": {}}],
            "filter": filter_clauses,
        }
        if should_clauses:
            bool_query["should"] = should_clauses

        inner_query: Dict[str, Any] = {"bool": bool_query}

        # Wrap in function_score for popularity boost (employee count).
        # Disabled when factor is 0.
        if popularity_factor > 0:
            return {
                "query": {
                    "function_score": {
                        "query": inner_query,
                        "functions": [
                            {
                                "field_value_factor": {
                                    "field": "current_employee_estimate",
                                    "factor": popularity_factor,
                                    "modifier": "log1p",
                                    "missing": 1,
                                }
                            }
                        ],
                        "boost_mode": "multiply",
                        "score_mode": "multiply",
                    }
                }
            }
        return {"query": inner_query}
    
    def _process_results(self, response: Dict, context: SearchContext) -> List[SearchResult]:
        """Convert OpenSearch response to SearchResult objects"""
        results = []
        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            results.append(SearchResult(
                company_id=source.get("company_id", hit.get("_id")),
                company_name=source.get("name"),
                domain=source.get("domain"),
                industry=source.get("industry"),
                country=source.get("country"),
                locality=source.get("locality"),
                relevance_score=float(hit.get("_score", 0)),
                search_method=self.strategy_type,
                ranking_source="bm25",
                matching_reason="Matched on name, domain, industry fields",
                year_founded=source.get("year_founded"),
                size_range=source.get("size_range"),
                current_employee_estimate=source.get("current_employee_estimate"),
            ))
        return results
    
    def get_strategy_type(self) -> str:
        """Return strategy identifier"""
        return self.strategy_type


class SemanticSearchStrategy(SearchStrategy):
    """
    Bucket 2: Conceptual Path - Vector (k-NN) search with hybrid scoring.
    Best for: Natural language, synonyms, conceptual queries.
    """

    @property
    def _DEFAULT_FIELD_BOOSTS(self) -> Dict[str, float]:
        """Fallback field boosts loaded from search_config.yaml."""
        return dict(get_search_config().get("field_boosts", {}).get("defaults", {
            "name": 2.0, "domain": 1.0, "searchable_text": 2.0,
            "industry": 1.0, "locality": 1.0,
        }))

    @property
    def _RRF_K(self) -> int:  # type: ignore[override]
        return get_search_config().get("rrf", {}).get("k", 60)

    def __init__(self, opensearch_service, embedding_service):
        """Initialize with OpenSearch and embedding service"""
        self.opensearch = opensearch_service
        self.embeddings = embedding_service
        self.strategy_type = "semantic"

    def search(self, context: SearchContext, progress_callback=None) -> tuple[List[SearchResult], Dict[str, Any]]:
        """
        Execute semantic search.

        Mode is controlled by search_config.yaml  semantic.mode:
          - "knn" (default): pure k-NN vector search — single OpenSearch query.
          - "rrf": hybrid Reciprocal Rank Fusion merging BM25 + k-NN legs.
        """
        mode = get_search_config().get("semantic", {}).get("mode", "knn")
        if mode == "rrf":
            return self._search_rrf(context, progress_callback=progress_callback)
        return self._search_knn(context, progress_callback=progress_callback)

    # ------------------------------------------------------------------
    # Pure k-NN path
    # ------------------------------------------------------------------

    def _search_knn(self, context: SearchContext, progress_callback=None) -> tuple[List[SearchResult], Dict[str, Any]]:
        """Pure k-NN vector search with automatic BM25 fallback on timeout.

        With 7M vectors on a single node the HNSW graph can be slow to
        traverse (or even to load from disk on a cold start).  If kNN
        times out, we transparently fall back to a BM25 lexical search
        so the user still gets results.
        """
        def _emit(phase: str, message: str) -> None:
            if progress_callback is not None:
                try:
                    progress_callback(phase, message)
                except Exception:
                    pass

        start_time = time.time()

        logger.info(
            "semantic_search_started",
            trace_id=context.trace_id,
            query=context.query[:100],
            mode="knn",
        )

        try:
            # --- Step 1: Generate embedding ---
            _emit("embedding", "Generating vector embedding…")
            embed_start = time.time()
            try:
                embedding = self.embeddings.embed(context.optimized_query)
            except Exception as embed_err:
                logger.error(
                    "semantic_embedding_failed",
                    trace_id=context.trace_id,
                    query=context.optimized_query[:100],
                    error=str(embed_err),
                    error_type=type(embed_err).__name__,
                )
                raise
            embed_ms = int((time.time() - embed_start) * 1000)
            logger.info(
                "semantic_embedding_completed",
                trace_id=context.trace_id,
                embed_ms=embed_ms,
                embedding_dim=len(embedding) if embedding else 0,
            )

            # --- Step 2: Execute kNN query ---
            _emit("vector_search", "Searching vector index…")
            knn_start = time.time()
            try:
                knn_body = self._build_knn_query(context, embedding)
                knn_response = self.opensearch.search(
                    index=get_settings().OPENSEARCH_INDEX_NAME,
                    body=knn_body,
                    size=context.limit,
                    from_=0,
                )
            except ConnectionTimeout:
                knn_ms = int((time.time() - knn_start) * 1000)
                logger.warning(
                    "knn_timeout_falling_back_to_bm25",
                    trace_id=context.trace_id,
                    query=context.query[:100],
                    knn_ms=knn_ms,
                )
                return self._bm25_fallback(context, start_time)
            except Exception as knn_err:
                logger.error(
                    "semantic_knn_query_failed",
                    trace_id=context.trace_id,
                    query=context.query[:100],
                    error=str(knn_err),
                    error_type=type(knn_err).__name__,
                )
                raise
            knn_ms = int((time.time() - knn_start) * 1000)

            knn_hits = knn_response.get("hits", {}).get("hits", [])

            page_start = (context.page - 1) * context.limit
            page_hits = knn_hits[page_start: page_start + context.limit]

            results = self._process_knn_results(page_hits, context)

            execution_time = time.time() - start_time
            metadata = {
                "strategy": self.strategy_type,
                "mode": "knn",
                "total_hits": len(knn_hits),
                "returned": len(results),
                "execution_time_ms": int(execution_time * 1000),
                "embed_ms": embed_ms,
                "knn_ms": knn_ms,
                "embedding_dim": len(embedding) if embedding else 0,
                "score_range": self._get_score_range(results),
            }

            logger.info(
                "semantic_search_completed",
                trace_id=context.trace_id,
                **metadata,
            )

            return results, metadata

        except Exception as e:
            logger.error(
                "semantic_search_failed",
                trace_id=context.trace_id,
                error=str(e),
                error_type=type(e).__name__,
                elapsed_ms=int((time.time() - start_time) * 1000),
            )
            raise

    def _bm25_fallback(self, context: SearchContext, start_time: float) -> tuple[List[SearchResult], Dict[str, Any]]:
        """BM25 fallback when kNN times out — keeps the query alive."""
        bm25_body = self._build_bm25_query(context)
        response = self.opensearch.search(
            index=get_settings().OPENSEARCH_INDEX_NAME,
            body=bm25_body,
            size=context.limit,
            from_=(context.page - 1) * context.limit,
        )
        results = []
        for hit in response.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            results.append(SearchResult(
                company_id=source.get("company_id", hit.get("_id")),
                company_name=source.get("name"),
                domain=source.get("domain"),
                industry=source.get("industry"),
                country=source.get("country"),
                locality=source.get("locality"),
                relevance_score=float(hit.get("_score", 0)),
                search_method="bm25_fallback",
                ranking_source="bm25_fallback",
                matching_reason="BM25 fallback (kNN timed out on large index)",
                year_founded=source.get("year_founded"),
                size_range=source.get("size_range"),
                current_employee_estimate=source.get("current_employee_estimate"),
            ))
        execution_time = time.time() - start_time
        metadata = {
            "strategy": "bm25_fallback",
            "mode": "bm25_fallback",
            "total_hits": response.get("hits", {}).get("total", {}).get("value", 0),
            "returned": len(results),
            "execution_time_ms": int(execution_time * 1000),
            "score_range": self._get_score_range(results),
            "fallback_reason": "knn_timeout",
        }
        logger.info("bm25_fallback_completed", trace_id=context.trace_id, **metadata)
        return results, metadata

    def _process_knn_results(self, hits: List[Dict], context: SearchContext) -> List[SearchResult]:
        """Convert k-NN hits to SearchResult objects."""
        results = []
        for hit in hits:
            source = hit.get("_source", {})
            results.append(SearchResult(
                company_id=source.get("company_id", hit.get("_id")),
                company_name=source.get("name"),
                domain=source.get("domain"),
                industry=source.get("industry"),
                country=source.get("country"),
                locality=source.get("locality"),
                relevance_score=float(hit.get("_score", 0)),
                search_method=self.strategy_type,
                ranking_source="knn",
                matching_reason="Semantic vector similarity match",
                year_founded=source.get("year_founded"),
                size_range=source.get("size_range"),
                current_employee_estimate=source.get("current_employee_estimate"),
            ))
        return results

    # ------------------------------------------------------------------
    # RRF hybrid path
    # ------------------------------------------------------------------

    def _search_rrf(self, context: SearchContext, progress_callback=None) -> tuple[List[SearchResult], Dict[str, Any]]:
        """Hybrid search using Reciprocal Rank Fusion (BM25 + k-NN)."""
        def _emit(phase: str, message: str) -> None:
            if progress_callback is not None:
                try:
                    progress_callback(phase, message)
                except Exception:
                    pass

        start_time = time.time()

        logger.info(
            "semantic_search_started",
            trace_id=context.trace_id,
            query=context.query[:100],
            mode="rrf",
        )

        try:
            _emit("embedding", "Generating vector embedding…")
            embedding = self.embeddings.embed(context.optimized_query)

            _emit("vector_search", "Running hybrid BM25 + vector search…")

            rrf_cfg = get_search_config().get("rrf", {})
            fetch_size = max(context.limit * rrf_cfg.get("fetch_multiplier", 4), 100)

            bm25_response = self.opensearch.search(
                index=get_settings().OPENSEARCH_INDEX_NAME,
                body=self._build_bm25_query(context),
                size=fetch_size,
                from_=0,
            )

            knn_response = self.opensearch.search(
                index=get_settings().OPENSEARCH_INDEX_NAME,
                body=self._build_knn_query(context, embedding),
                size=fetch_size,
                from_=0,
            )

            bm25_hits = bm25_response.get("hits", {}).get("hits", [])
            knn_hits = knn_response.get("hits", {}).get("hits", [])
            merged_hits = self._rrf_merge(bm25_hits, knn_hits)

            page_start = (context.page - 1) * context.limit
            page_hits = merged_hits[page_start: page_start + context.limit]

            results = self._process_rrf_results(page_hits, context)

            execution_time = time.time() - start_time
            effective_boosts = self._resolve_field_boosts(context)
            metadata = {
                "strategy": self.strategy_type,
                "mode": "rrf",
                "total_hits": len(merged_hits),
                "returned": len(results),
                "execution_time_ms": int(execution_time * 1000),
                "embedding_dim": len(embedding) if embedding else 0,
                "score_range": self._get_score_range(results),
                "field_boosts_applied": effective_boosts,
                "bm25_candidates": len(bm25_hits),
                "knn_candidates": len(knn_hits),
            }

            logger.info(
                "semantic_search_completed",
                trace_id=context.trace_id,
                **metadata
            )

            return results, metadata

        except Exception as e:
            logger.error(
                "semantic_search_failed",
                trace_id=context.trace_id,
                error=str(e)
            )
            raise
    
    def _resolve_field_boosts(self, context: SearchContext) -> Dict[str, float]:
        """Merge LLM-extracted boosts with defaults.

        The classifier's values take precedence; any field not specified by the
        classifier falls back to _DEFAULT_FIELD_BOOSTS.  This guarantees all
        five fields are always present and the query never omits a field.
        """
        classifier_boosts = context.field_boosts or {}
        if not classifier_boosts:
            return dict(self._DEFAULT_FIELD_BOOSTS)
        # Start from defaults, override with whatever the classifier provided
        merged = dict(self._DEFAULT_FIELD_BOOSTS)
        for field, boost in classifier_boosts.items():
            if field in merged and isinstance(boost, (int, float)) and boost > 0:
                merged[field] = float(boost)
        return merged

    def _build_bm25_query(self, context: SearchContext) -> Dict[str, Any]:
        """BM25 leg — multi_match with LLM-extracted field boosts + filters."""
        filter_clauses = self._build_filters(context.filters)
        logger.info(
            "search_filters_applied",
            strategy="semantic_bm25_leg",
            trace_id=context.trace_id,
            raw_filters=context.filters,
            num_filter_clauses=len(filter_clauses),
        )
        effective_boosts = self._resolve_field_boosts(context)
        boosted_fields = self._boosts_to_fields(effective_boosts)

        bool_query: Dict[str, Any] = {
            "must": [
                {
                    "multi_match": {
                        "query": context.optimized_query,
                        "fields": boosted_fields,
                        "type": "best_fields",
                        "operator": "or",
                    }
                }
            ]
        }
        if filter_clauses:
            bool_query["filter"] = filter_clauses

        return {"query": {"bool": bool_query}}

    def _build_knn_query(self, context: SearchContext, embedding: List[float]) -> Dict[str, Any]:
        """k-NN leg — cosine similarity on the BGE vector field + filters.

        OpenSearch requires `knn` to be the TOP-LEVEL query type — it cannot
        be nested inside a bool.must clause. Filters are placed INSIDE the knn
        clause (supported since OpenSearch 2.x) so that filtering is applied
        at the ANN candidate selection stage for efficiency.
        """
        filter_clauses = self._build_filters(context.filters)
        logger.info(
            "search_filters_applied",
            strategy="semantic_knn_leg",
            trace_id=context.trace_id,
            raw_filters=context.filters,
            num_filter_clauses=len(filter_clauses),
        )

        rrf_cfg = get_search_config().get("rrf", {})
        knn_params: Dict[str, Any] = {
            "vector": embedding,
            "k": rrf_cfg.get("knn_k", 50),
        }
        # ef_search caps the HNSW search effort — critical for large indices
        ef_search = rrf_cfg.get("ef_search")
        if ef_search:
            knn_params["method_parameters"] = {"ef_search": ef_search}
        if filter_clauses:
            knn_params["filter"] = {"bool": {"must": filter_clauses}}

        return {"query": {"knn": {"vector_embedding": knn_params}}}

    def _rrf_merge(
        self,
        bm25_hits: List[Dict],
        knn_hits: List[Dict],
        k: Optional[int] = None,
    ) -> List[Dict]:
        """
        Merge two ranked hit lists using Reciprocal Rank Fusion.

        rrf_score(doc) = sum over lists of 1 / (k + rank_in_list)

        Documents that appear in both lists get contributions from both.
        Documents that appear in only one list get a contribution from that list.
        """
        if k is None:
            k = self._RRF_K
        scores: Dict[str, float] = {}
        # Store the best _source for each doc (prefer knn as it has full source)
        sources: Dict[str, Dict] = {}

        for rank, hit in enumerate(bm25_hits, start=1):
            doc_id = hit["_id"]
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
            sources.setdefault(doc_id, hit)

        for rank, hit in enumerate(knn_hits, start=1):
            doc_id = hit["_id"]
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
            sources.setdefault(doc_id, hit)

        # Sort descending by RRF score and annotate each hit
        sorted_ids = sorted(scores, key=lambda d: scores[d], reverse=True)
        merged = []
        for doc_id in sorted_ids:
            hit = dict(sources[doc_id])
            hit["_rrf_score"] = scores[doc_id]
            merged.append(hit)
        return merged

    def _process_rrf_results(self, hits: List[Dict], context: SearchContext) -> List[SearchResult]:
        """Convert RRF-merged hits to SearchResult objects, using _rrf_score as relevance."""
        results = []
        for hit in hits:
            source = hit.get("_source", {})
            results.append(SearchResult(
                company_id=source.get("company_id", hit.get("_id")),
                company_name=source.get("name"),
                domain=source.get("domain"),
                industry=source.get("industry"),
                country=source.get("country"),
                locality=source.get("locality"),
                relevance_score=float(hit.get("_rrf_score", hit.get("_score", 0))),
                search_method=self.strategy_type,
                ranking_source="rrf_hybrid",
                matching_reason="Hybrid semantic + lexical match ranked by Reciprocal Rank Fusion",
                year_founded=source.get("year_founded"),
                size_range=source.get("size_range"),
                current_employee_estimate=source.get("current_employee_estimate"),
            ))
        return results
    
    def get_strategy_type(self) -> str:
        """Return strategy identifier"""
        return self.strategy_type


class AgenticSearchStrategy(SearchStrategy):
    """
    Bucket 3: External Path - Tool-based search for time-sensitive/external data.
    Best for: Recent news, funding, events, etc.

    Routes between two paths:
      Fast path  — deterministic async pipeline (AgenticPipeline) for ~85% of queries:
                   event-type queries without a specific named company.
                   2 LLM calls (both gpt-4o-mini), parallel Tavily, batch msearch.
      Flex path  — LangChain ReAct agent for complex/named-company queries:
                   LinkedIn lookups, multi-hop reasoning, specific company profiles.
    """

    # Event types that qualify for the fast deterministic pipeline.
    # Queries about these types follow a predictable search → extract → resolve pattern.
    _FAST_PATH_TYPES = frozenset({
        "funding", "ipo", "acquisition", "layoffs", "expansion",
        "product_launch", "merger", "partnership", "news",
    })

    # Detects a specific named company in the query.
    # Triggers flex path (ReAct agent handles LinkedIn + named-company enrichment).
    _NAMED_COMPANY_RE = re.compile(
        r'"[^"]{3,50}"'                                         # "Stripe Inc" — quoted name
        r'|\b(?:about|for|regarding|on)\s+[A-Z][a-z]+'         # "about Stripe" — title-case after preposition
        r'|\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}'
        r'\s+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|GmbH|Plc|PLC'        # "Stripe Inc/Ltd" — with legal suffix
        r'|inc\.?|llc|ltd\.?|corp\.?|gmbh|plc)\b',
    )

    # Detects LinkedIn / detailed profile requests → always flex path.
    _LINKEDIN_RE = re.compile(
        r'\blinkedin\b|\bprofile\b|\bdetails?\s+(?:about|of|for)\b',
        re.IGNORECASE,
    )

    def __init__(self, opensearch_service, tool_service, pipeline=None):
        """
        Args:
            opensearch_service: OpenSearch client wrapper.
            tool_service:       ToolService wrapping the ReAct agent (flex path).
            pipeline:           Optional AgenticPipeline for the fast deterministic path.
                                Pass None to disable fast path and always use flex agent.
        """
        self.opensearch = opensearch_service
        self.tools = tool_service
        self.pipeline = pipeline  # AgenticPipeline | None
        self.strategy_type = "agentic"

    def search(
        self,
        context: SearchContext,
        intent: Optional["QueryIntent"] = None,
        progress_callback: Optional[Any] = None,
    ) -> tuple[List[SearchResult], Dict[str, Any]]:
        """
        Execute agentic search, routing to the fast pipeline or flex agent.

        Fast path  — async deterministic pipeline via asyncio.run()
                     (safe: this method runs in a thread pool, not the event loop)
        Flex path  — existing LangChain ReAct agent (unchanged)
        """
        from app.config import get_settings
        if not get_settings().ENABLE_AGENTIC_SEARCH:
            raise NotImplementedError("Agentic search is disabled via ENABLE_AGENTIC_SEARCH setting")

        if intent and self.pipeline and self._should_use_fast_path(context.query, intent):
            return self._run_fast_path(context, intent, progress_callback)
        return self._run_flex_path(context, progress_callback)

    # ------------------------------------------------------------------
    # Routing helpers
    # ------------------------------------------------------------------

    def _should_use_fast_path(self, query: str, intent: "QueryIntent") -> bool:
        """
        Return True when the fast deterministic pipeline is appropriate.

        Fast path requires:
          1. external_data_type is a supported event type
          2. No specific named company detected (agent handles those via LinkedIn)
          3. No LinkedIn / profile request detected
        """
        if intent.external_data_type not in self._FAST_PATH_TYPES:
            return False
        if self._NAMED_COMPANY_RE.search(query):
            return False
        if self._LINKEDIN_RE.search(query):
            return False
        return True

    # ------------------------------------------------------------------
    # Fast path — deterministic async pipeline
    # ------------------------------------------------------------------

    def _run_fast_path(
        self,
        context: SearchContext,
        intent: "QueryIntent",
        progress_callback: Optional[Any],
    ) -> tuple[List[SearchResult], Dict[str, Any]]:
        """
        Run the AgenticPipeline via asyncio.run().

        asyncio.run() is safe here because this method executes in a worker
        thread (via FastAPI's run_in_executor), not inside the event loop.
        Falls back to the flex ReAct agent on any pipeline error.
        """
        start_time = time.time()

        logger.info(
            "agentic_fast_path_started",
            trace_id=context.trace_id,
            query=context.query[:100],
            external_data_type=intent.external_data_type,
        )

        try:
            external_docs = asyncio.run(
                self.pipeline.run(
                    query=context.query,
                    intent=intent,
                    progress_callback=progress_callback,
                )
            )
        except Exception as exc:
            logger.warning(
                "agentic_fast_path_failed_falling_back_to_flex",
                trace_id=context.trace_id,
                error=str(exc),
            )
            return self._run_flex_path(context, progress_callback)

        results = self._docs_to_results(external_docs, context)
        results = self._apply_post_filters(results, context)

        execution_time = time.time() - start_time
        metadata = {
            "strategy": self.strategy_type,
            "path": "fast_pipeline",
            "external_tool_used": context.filters.get("external_data_type"),
            "external_results": len(external_docs),
            "matching_companies": len(results),
            "execution_time_ms": int(execution_time * 1000),
            "score_range": self._get_score_range(results),
        }

        logger.info(
            "agentic_fast_path_completed",
            trace_id=context.trace_id,
            **metadata,
        )
        return results, metadata

    # ------------------------------------------------------------------
    # Flex path — ReAct agent (unchanged from previous implementation)
    # ------------------------------------------------------------------

    def _run_flex_path(
        self,
        context: SearchContext,
        progress_callback: Optional[Any],
    ) -> tuple[List[SearchResult], Dict[str, Any]]:
        """
        Execute agentic search using the LangChain ReAct agent.
        Used for complex / named-company / LinkedIn queries.
        """
        start_time = time.time()

        logger.info(
            "agentic_flex_path_started",
            trace_id=context.trace_id,
            query=context.query[:100],
            data_type=context.filters.get("external_data_type"),
        )

        try:
            # Call external tool — returns list of source dicts
            external_docs = self._call_external_tool(context, progress_callback=progress_callback)

            # Convert to SearchResult objects directly (no second OpenSearch lookup)
            results = self._docs_to_results(external_docs, context)

            # Apply user filters as post-processing (narrow down results)
            results = self._apply_post_filters(results, context)

            execution_time = time.time() - start_time
            metadata = {
                "strategy": self.strategy_type,
                "path": "flex_agent",
                "external_tool_used": context.filters.get("external_data_type"),
                "external_results": len(external_docs),
                "matching_companies": len(results),
                "execution_time_ms": int(execution_time * 1000),
                "score_range": self._get_score_range(results),
            }

            logger.info(
                "agentic_flex_path_completed",
                trace_id=context.trace_id,
                **metadata,
            )
            return results, metadata

        except Exception as e:
            logger.error(
                "agentic_search_failed",
                trace_id=context.trace_id,
                error=str(e),
            )
            raise
    
    def _call_external_tool(
        self,
        context: SearchContext,
        progress_callback: Optional[Any] = None,
    ) -> List[Dict]:
        """Call external tool (news API, funding database, etc.)"""
        data_type = context.filters.get("external_data_type", "news")

        if self.tools is None:
            raise NotImplementedError(
                f"No tool service configured for agentic search (data_type='{data_type}'). "
                "Provide a real tool_service when initializing AgenticSearchStrategy."
            )

        logger.info(
            "external_tool_called",
            trace_id=context.trace_id,
            tool_type=data_type,
            query=context.query[:100]
        )

        return self.tools.call(data_type, context.query, progress_callback=progress_callback)

    def _docs_to_results(self, docs: List[Dict], context: SearchContext) -> List[SearchResult]:
        """Convert ToolService source dicts directly to SearchResult objects."""
        results = []
        data_type = context.filters.get("external_data_type", "external")
        for doc in docs:
            event = doc.get("_event_data")
            profile = doc.get("_linkedin_profile")
            if event and event.get("summary"):
                date_suffix = f" ({event['date']})" if event.get("date") else ""
                matching_reason = f"{event['summary']}{date_suffix}"
            elif profile and profile.get("description"):
                matching_reason = profile["description"][:200]
            else:
                matching_reason = f"Identified via {data_type} data for query: {context.query[:60]}"
            results.append(SearchResult(
                company_id=doc.get("company_id", doc.get("_id", "")),
                company_name=doc.get("name", ""),
                domain=doc.get("domain", ""),
                industry=doc.get("industry", ""),
                country=doc.get("country", ""),
                locality=doc.get("locality", ""),
                relevance_score=float(doc.get("_score", 1.0)),
                search_method=self.strategy_type,
                ranking_source="tool",
                matching_reason=matching_reason,
                event_data=event,
                linkedin_profile=doc.get("_linkedin_profile"),
            ))
        return results

    def _apply_post_filters(self, results: List[SearchResult], context: SearchContext) -> List[SearchResult]:
        """
        Apply user-selected filters as post-processing on agentic results.
        This is a soft filter — we narrow down what the external tool returned.

        Important: docs with empty location/industry fields are KEPT — we don't
        know their values so we can't safely exclude them (prevents synthetic
        docs from being dropped when a location filter is active).
        """
        filters = context.filters
        if not filters:
            return results

        filtered = []
        for r in results:
            # Country filter — skip if the doc has no country data
            if country := filters.get("location_country"):
                if (r.country or "") and country.lower() not in (r.country or "").lower():
                    continue
            # State filter — check against locality string; skip if no locality data
            if state := filters.get("location_state"):
                if (r.locality or "") and state.lower() not in (r.locality or "").lower():
                    continue
            # City filter — check against locality string; skip if no locality data
            if city := filters.get("location_city"):
                if (r.locality or "") and city.lower() not in (r.locality or "").lower():
                    continue
            # Industry filter — skip if the doc has no industry data
            industries: List[str] = filters.get("industries") or []
            if not industries and filters.get("industry"):
                industries = [filters["industry"]]
            if industries and (r.industry or ""):
                if not any(ind.lower() in (r.industry or "").lower() for ind in industries):
                    continue
            filtered.append(r)

        logger.info(
            "post_filter_applied",
            before=len(results),
            after=len(filtered),
            filters={k: v for k, v in filters.items() if k in (
                "location_country", "location_state", "location_city", "industry", "industries"
            )},
        )
        if not filtered:
            logger.warning(
                "post_filter_dropped_all",
                result_count=len(results),
                filters=filters,
            )
            # Return an empty list to honour the user's filter intent.
            # Returning unfiltered results here would silently show the user
            # companies that don't match their selected location/industry filters.
            return []
        return filtered

    def get_strategy_type(self) -> str:
        """Return strategy identifier"""
        return self.strategy_type
