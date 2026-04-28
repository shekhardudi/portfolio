"""
OpenSearch client and integration service.
Handles all direct interactions with OpenSearch.
"""
import structlog
from functools import lru_cache
from typing import Dict, List, Any, Optional
from opensearchpy import OpenSearch
from opensearchpy.exceptions import OpenSearchException
from app.config import get_settings
import json

logger = structlog.get_logger(__name__)


class OpenSearchService:
    """Service for OpenSearch operations"""
    
    def __init__(self):
        """Initialize OpenSearch client"""
        self.settings = get_settings()
        self._client = None
    
    @property
    def client(self) -> OpenSearch:
        """Lazy-load OpenSearch client"""
        if self._client is None:
            try:
                self._client = OpenSearch(
                    hosts=[{
                        "host": self.settings.OPENSEARCH_HOST,
                        "port": self.settings.OPENSEARCH_PORT,
                    }],
                    http_auth=(
                        self.settings.OPENSEARCH_USER,
                        self.settings.OPENSEARCH_PASSWORD
                    ),
                    use_ssl=True,
                    verify_certs=self.settings.OPENSEARCH_VERIFY_CERTS,
                    timeout=60,
                    max_retries=2,
                )
                logger.info("opensearch_client_initialized")
            except Exception as e:
                logger.error("opensearch_connection_failed", error=str(e))
                raise
        
        return self._client
    
    def health_check(self) -> bool:
        """Check if OpenSearch is healthy"""
        try:
            info = self.client.info()
            logger.debug("opensearch_health_check_passed")
            return True
        except Exception as e:
            logger.error("opensearch_health_check_failed", error=str(e))
            return False
    
    def create_index(self, index_name: str, mappings: Dict[str, Any]) -> bool:
        """Create an index with given mappings"""
        try:
            if self.client.indices.exists(index_name):
                logger.info("index_already_exists", index=index_name)
                return True
            
            self.client.indices.create(
                index=index_name,
                body=mappings
            )
            logger.info("index_created", index=index_name)
            return True
        except Exception as e:
            logger.error("index_creation_failed", index=index_name, error=str(e))
            return False
    
    def index_document(self, index: str, doc_id: str, document: Dict[str, Any]) -> bool:
        """Index a single document"""
        try:
            self.client.index(
                index=index,
                id=doc_id,
                body=document
            )
            return True
        except Exception as e:
            logger.error("document_indexing_failed", doc_id=doc_id, error=str(e))
            return False
    
    def bulk_index(self, index: str, documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Bulk index documents"""
        bulk_body = []
        for doc in documents:
            doc_id = doc.pop("_id") if "_id" in doc else None
            bulk_body.append({
                "index": {
                    "_index": index,
                    "_id": doc_id
                }
            })
            bulk_body.append(doc)
        
        try:
            response = self.client.bulk(
                body=bulk_body,
                timeout="30s"
            )
            logger.info(
                "bulk_indexing_completed",
                total=len(documents),
                errors=response.get("errors", False)
            )
            return response
        except Exception as e:
            logger.error("bulk_indexing_failed", error=str(e))
            raise
    
    def search(
        self,
        index: str,
        query: Optional[Dict[str, Any]] = None,
        size: int = 20,
        from_: int = 0,
        body: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute a search query.

        Pass either ``query`` (a bare query dict that will be wrapped) or
        ``body`` (a complete request body, e.g. for hybrid / agentic queries
        that include ``rank`` or ``post_filter`` alongside ``query``).
        ``size`` and ``from_`` are merged into whichever form is used.
        The client-level timeout (30 s) is used; no per-request timeout
        string is passed so urllib3 never receives an invalid value.
        """
        import time as _time
        try:
            if body is not None:
                request_body = {**body, "size": size, "from": from_}
            else:
                request_body = {"query": query, "size": size, "from": from_}

            _t0 = _time.perf_counter()
            response = self.client.search(
                index=index,
                body=request_body,
            )
            _duration_ms = int((_time.perf_counter() - _t0) * 1000)

            try:
                from app.observability.metrics import get_search_metrics
                get_search_metrics()["opensearch_query_duration_ms"].record(
                    _duration_ms, {"index": index}
                )
            except Exception:
                pass  # metrics must never break the query path

            logger.debug(
                "search_executed",
                hits=len(response["hits"]["hits"]),
                total=response["hits"]["total"].get("value", 0)
            )
            return response
        except Exception as e:
            logger.error("search_failed", error=str(e), query=query or body)
            raise
    
    def search_with_aggs(
        self,
        index: str,
        query: Dict[str, Any],
        aggs: Dict[str, Any],
        size: int = 20,
        from_: int = 0
    ) -> Dict[str, Any]:
        """Search with aggregations (facets)"""
        try:
            response = self.client.search(
                index=index,
                body={
                    "query": query,
                    "aggs": aggs,
                    "size": size,
                    "from": from_,
                }
            )
            return response
        except Exception as e:
            logger.error("search_with_aggs_failed", error=str(e))
            raise
    
    def vector_search(
        self,
        index: str,
        vector_field: str,
        query_vector: List[float],
        k: int = 20,
        min_score: float = 0.7
    ) -> List[Dict[str, Any]]:
        """Perform vector similarity search"""
        try:
            response = self.search(
                index=index,
                query={
                    "knn": {
                        vector_field: {
                            "vector": query_vector,
                            "k": k
                        }
                    }
                },
                size=k
            )
            
            results = []
            for hit in response["hits"]["hits"]:
                if hit.get("_score", 0) >= min_score:
                    results.append({
                        "id": hit["_id"],
                        "source": hit["_source"],
                        "score": hit.get("_score", 0)
                    })
            
            return results
        except Exception as e:
            logger.error("vector_search_failed", error=str(e))
            return []
    
    def get_document(self, index: str, doc_id: str) -> Optional[Dict[str, Any]]:
        """Get a single document by ID"""
        try:
            response = self.client.get(index=index, id=doc_id)
            return response["_source"]
        except Exception as e:
            logger.error("get_document_failed", doc_id=doc_id, error=str(e))
            return None
    
    def delete_document(self, index: str, doc_id: str) -> bool:
        """Delete a document"""
        try:
            self.client.delete(index=index, id=doc_id)
            return True
        except Exception as e:
            logger.error("delete_document_failed", doc_id=doc_id, error=str(e))
            return False
    
    def update_document(self, index: str, doc_id: str, partial_doc: Dict[str, Any]) -> bool:
        """Update a document (partial)"""
        try:
            self.client.update(
                index=index,
                id=doc_id,
                body={"doc": partial_doc}
            )
            return True
        except Exception as e:
            logger.error("update_document_failed", doc_id=doc_id, error=str(e))
            return False
    
    def get_index_stats(self, index: str) -> Dict[str, Any]:
        """Get index statistics"""
        try:
            stats = self.client.indices.stats(index=index)
            doc_count = stats["indices"][index]["primaries"]["docs"]["count"]
            size_bytes = stats["indices"][index]["primaries"]["store"]["size_in_bytes"]
            
            return {
                "document_count": doc_count,
                "size_bytes": size_bytes,
                "size_mb": round(size_bytes / 1024 / 1024, 2)
            }
        except Exception as e:
            logger.error("get_index_stats_failed", index=index, error=str(e))
            return {}
    
    def warmup_knn(self, index: str) -> bool:
        """Pre-load HNSW graphs into native memory via the kNN warmup API.

        Without this, the first kNN query after a cold start must load the
        entire graph from disk, which can exceed the client timeout on large
        indices (e.g. 7M × 384-dim).  Uses a 5-minute timeout because loading
        a ~5-7 GB graph from EBS gp3 is I/O-bound.

        Also raises the kNN memory circuit breaker limit from the default 50%
        to 80% of native memory — on an r6g.large (16 GB, ~8 GB native) this
        gives the graph ~6.4 GB instead of ~4 GB.
        """
        # Raise circuit breaker limit so the full graph fits in native memory
        try:
            self.client.cluster.put_settings(body={
                "persistent": {
                    "knn.memory.circuit_breaker.limit": "80%",
                }
            })
            logger.info("knn_circuit_breaker_limit_set", limit="80%")
        except Exception as e:
            logger.warning("knn_circuit_breaker_setting_failed", error=str(e))

        try:
            response = self.client.transport.perform_request(
                "GET",
                f"/_plugins/_knn/warmup/{index}?timeout=300s",
            )
            logger.info(
                "knn_warmup_completed",
                index=index,
                response=response,
            )
            return True
        except Exception as e:
            logger.warning("knn_warmup_failed", index=index, error=str(e))
            return False

    def close(self):
        """Close the OpenSearch connection"""
        if self._client:
            self._client.close()
            logger.info("opensearch_client_closed")


@lru_cache(maxsize=1)
def get_opensearch_service() -> OpenSearchService:
    """Get or create OpenSearch service singleton"""
    return OpenSearchService()
