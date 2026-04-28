"""
Core search service - structured filter-based company search (basic_search).
Semantic and agentic search are handled by the orchestrator via search strategies.
"""
import structlog
import time
from functools import lru_cache
from typing import Dict, List, Any, Optional
from app.services.cache_service import get_cache_service
from app.services.opensearch_service import get_opensearch_service
from app.models.search import (
    BasicSearchRequest, BasicSearchResponse, CompanySearchResult,
    SearchFacets, FacetValue, Company
)
from app.config import get_settings

logger = structlog.get_logger(__name__)


class SearchService:
    """Main search service"""
    
    def __init__(self):
        self.settings = get_settings()
        self.opensearch = get_opensearch_service()
        self.cache = get_cache_service()
        self.index_name = self.settings.OPENSEARCH_INDEX_NAME
    
    # ========================================================================
    # Basic Structured Search
    # ========================================================================
    
    def basic_search(self, request: BasicSearchRequest) -> BasicSearchResponse:
        """
        Perform structured company search with filters.
        Fast path using OpenSearch only.
        """
        # Cache lookup
        _cache_key = self.cache.make_key(
            "basic",
            {
                "q": request.q,
                "page": request.page,
                "limit": request.limit,
                "industry": sorted(request.industry or []),
                "country": request.country,
                "locality": request.locality,
                "year_from": request.year_from,
                "year_to": request.year_to,
                "size": sorted(request.size or []),
                "sort": request.sort.value if request.sort else None,
            },
        )
        if self.settings.ENABLE_CACHING:
            _cached = self.cache.get(_cache_key)
            if _cached:
                try:
                    return BasicSearchResponse.model_validate_json(_cached)
                except Exception:
                    pass  # Corrupt entry — fall through

        start_time = time.time()
        
        try:
            # Build OpenSearch query
            query = self._build_filter_query(request)
            
            # Build aggregations for facets
            aggs = self._build_aggregations()
            
            # Execute search
            from_ = (request.page - 1) * request.limit
            response = self.opensearch.search_with_aggs(
                index=self.index_name,
                query=query,
                aggs=aggs,
                size=request.limit,
                from_=from_
            )
            
            # Process results
            results = self._process_search_results(response)
            facets = self._process_facets(response.get("aggregations", {}))
            
            search_time_ms = int((time.time() - start_time) * 1000)
            
            logger.info("basic_search_completed",
                       total_hits=response["hits"]["total"].get("value", 0),
                       results_returned=len(results),
                       time_ms=search_time_ms)
            
            result = BasicSearchResponse(
                total=response["hits"]["total"].get("value", 0),
                page=request.page,
                limit=request.limit,
                results=results,
                facets=facets,
                search_time_ms=search_time_ms
            )

            if self.settings.ENABLE_CACHING:
                self.cache.set(_cache_key, result.model_dump_json())

            return result
            
        except Exception as e:
            logger.error("basic_search_failed", error=str(e))
            raise
    
    def _build_filter_query(self, request: BasicSearchRequest) -> Dict[str, Any]:
        """Build OpenSearch query from filter request"""
        filters = []
        must_queries = []
        
        # Text search
        if request.q:
            must_queries.append({
                "multi_match": {
                    "query": request.q,
                    "fields": [
                        "name^3",           # Boost name matches
                        "domain^2",
                        "industry",
                        "locality"
                    ],
                    "type": "best_fields",
                    "operator": "or"
                }
            })
        
        # Industry filter
        if request.industry:
            filters.append({
                "terms": {
                    "industry.keyword": request.industry
                }
            })
        
        # Country filter
        if request.country:
            filters.append({
                "term": {
                    "country.keyword": request.country
                }
            })
        
        # Locality filter
        if request.locality:
            filters.append({
                "match": {
                    "locality": {
                        "query": request.locality,
                        "operator": "and"
                    }
                }
            })
        
        # Year founded range
        if request.year_from or request.year_to:
            year_filter = {}
            if request.year_from:
                year_filter["gte"] = request.year_from
            if request.year_to:
                year_filter["lte"] = request.year_to
            filters.append({"range": {"year_founded": year_filter}})
        
        # Company size filter
        if request.size:
            size_ranges = self._map_size_to_ranges(request.size)
            filters.append({
                "terms": {
                    "size_range.keyword": size_ranges
                }
            })
        
        # Combine filters
        if filters or must_queries:
            query = {"bool": {}}
            if must_queries:
                query["bool"]["must"] = must_queries if len(must_queries) > 1 else must_queries[0]
            if filters:
                query["bool"]["filter"] = filters
            return query
        
        return {"match_all": {}}
    
    def _map_size_to_ranges(self, sizes: List[str]) -> List[str]:
        """Map size categories to actual ranges"""
        size_mapping = {
            "small": ["1-10", "11-50", "51-200"],
            "medium": ["201-500", "501-1000", "1001-5000", "5001-10000"],
            "large": ["10001+"],
            "enterprise": ["10001+"]
        }
        
        ranges = []
        for size in sizes:
            ranges.extend(size_mapping.get(size.lower(), []))
        
        return list(set(ranges))  # Remove duplicates
    
    def _build_aggregations(self) -> Dict[str, Any]:
        """Build aggregations for faceted search"""
        return {
            "industries": {
                "terms": {
                    "field": "industry.keyword",
                    "size": 20
                }
            },
            "countries": {
                "terms": {
                    "field": "country.keyword",
                    "size": 50
                }
            },
            "sizes": {
                "terms": {
                    "field": "size_range.keyword",
                    "size": 10
                }
            },
            "years": {
                "range": {
                    "field": "year_founded",
                    "ranges": [
                        {"to": 1990},
                        {"from": 1990, "to": 2000},
                        {"from": 2000, "to": 2010},
                        {"from": 2010, "to": 2020},
                        {"from": 2020}
                    ]
                }
            }
        }
    
    def _process_search_results(self, opensearch_response: Dict[str, Any]) -> List[CompanySearchResult]:
        """Convert OpenSearch results to CompanySearchResult objects"""
        results = []
        
        for hit in opensearch_response["hits"]["hits"]:
            source = hit["_source"]
            
            company = Company(
                id=source.get("company_id", hit["_id"]),
                name=source.get("name"),
                domain=source.get("domain"),
                year_founded=source.get("year_founded"),
                industry=source.get("industry"),
                size_range=source.get("size_range"),
                country=source.get("country"),
                locality=source.get("locality"),
                linkedin_url=source.get("linkedin_url"),
                current_employee_estimate=source.get("current_employee_estimate"),
                total_employee_estimate=source.get("total_employee_estimate")
            )
            
            result = CompanySearchResult(
                company=company,
                relevance_score=hit.get("_score", 0) / 10.0,  # Normalize to 0-1
                matching_reason=None
            )
            
            results.append(result)
        
        return results
    
    def _process_facets(self, aggs: Dict[str, Any]) -> SearchFacets:
        """Convert aggregations to SearchFacets"""
        return SearchFacets(
            industries=[
                FacetValue(name=b["key"], count=b["doc_count"])
                for b in aggs.get("industries", {}).get("buckets", [])
            ],
            countries=[
                FacetValue(name=b["key"], count=b["doc_count"])
                for b in aggs.get("countries", {}).get("buckets", [])
            ],
            size_ranges=[
                FacetValue(name=b["key"], count=b["doc_count"])
                for b in aggs.get("sizes", {}).get("buckets", [])
            ]
        )
    
@lru_cache(maxsize=1)
def get_search_service() -> SearchService:
    """Get or create search service singleton"""
    return SearchService()
