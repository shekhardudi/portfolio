"""
FastAPI application initialization and configuration.
Main entry point for the intelligent search API.
Implements the new orchestrator-based architecture with:
- Intent Classification (GPT-4o-mini + Instructor)
- Strategy Pattern (Regular, Semantic, Agentic Search)
- Hybrid Scoring (Reciprocal Rank Fusion)
- Observability & Tracing
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog
from contextlib import asynccontextmanager
import asyncio
import time
import uuid
from app.config import get_settings
from app.api import routes

# ---------------------------------------------------------------------------
# Logging — configured at import time so every module sees JSON output.
# ---------------------------------------------------------------------------
from app.observability import configure_logging
configure_logging(get_settings().LOG_LEVEL)

logger = structlog.get_logger(__name__)


# ============================================================================
# Lifespan Events
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handle application startup and shutdown.
    Initialize services and clean up resources.
    """
    # ========== Startup ==========
    logger.info(
        "application_startup",
        version="2.0.0",
        architecture="orchestrator-based"
    )

    settings = get_settings()
    logger.info(
        "configuration_loaded",
        environment=settings.ENVIRONMENT,
        opensearch_host=settings.OPENSEARCH_HOST,
        query_classification_enabled=settings.ENABLE_QUERY_CLASSIFICATION,
        semantic_search_enabled=settings.ENABLE_SEMANTIC_SEARCH,
        agentic_search_enabled=settings.ENABLE_AGENTIC_SEARCH,
    )

    # Configure OTel tracing + metrics (non-fatal on any import/config error)
    from app.observability import configure_tracing, configure_metrics, configure_log_export
    configure_tracing(settings.OTEL_SERVICE_NAME, settings.OTLP_ENDPOINT)
    configure_metrics(settings.OTEL_SERVICE_NAME, settings.OTLP_ENDPOINT)
    configure_log_export(settings.OTEL_SERVICE_NAME, settings.OTLP_ENDPOINT, settings.LOG_LEVEL)
    
    # Initialize and test OpenSearch connection
    try:
        from app.services.opensearch_service import get_opensearch_service
        opensearch = get_opensearch_service()
        is_healthy = opensearch.health_check()
        logger.info("opensearch_connection_test", healthy=is_healthy)
        # Pre-load HNSW graph into native memory so the first kNN query
        # doesn't time out on cold start (7M × 384-dim ≈ 5-7 GB to load).
        if is_healthy:
            opensearch.warmup_knn(settings.OPENSEARCH_INDEX_NAME)
    except Exception as e:
        logger.error("opensearch_initialization_failed", error=str(e))
    
    # Initialize Intent Classifier
    try:
        from app.services.intent_classifier import get_intent_classifier
        classifier = get_intent_classifier()
        logger.info(
            "intent_classifier_initialized",
            model=settings.OPENAI_MINI_MODEL
        )
    except Exception as e:
        logger.warning("intent_classifier_initialization_failed", error=str(e))
    
    # Initialize Embedding Service
    try:
        from app.services.embedding_service import get_embedding_service
        embeddings = get_embedding_service()
        _ = embeddings.model  # Eagerly load SentenceTransformer weights at startup
        logger.info(
            "embedding_service_initialized",
            embedding_dimension=embeddings.get_embedding_dimension(),
            model_path=embeddings.model_path
        )
    except Exception as e:
        logger.warning("embedding_service_initialization_failed", error=str(e))
    
    # Initialize Cache Service
    try:
        from app.services.cache_service import get_cache_service
        cache = get_cache_service()
        logger.info("cache_service_initialized", redis_available=cache.is_available)
    except Exception as e:
        logger.warning("cache_service_initialization_failed", error=str(e))

    # Initialize Search Orchestrator
    try:
        from app.services.orchestrator import get_search_orchestrator
        orchestrator = get_search_orchestrator()
        logger.info("search_orchestrator_initialized")
    except Exception as e:
        logger.error("search_orchestrator_initialization_failed", error=str(e))
    
    # Periodic semantic probe: a lightweight k=1 kNN query every 10 minutes
    # to validate the full pipeline (embedding model → kNN search → results).
    # The kNN warmup API is NOT needed here — with r6g.xlarge and
    # knn.cache.item.expiry.enabled=false the graph stays permanently in memory.
    async def _periodic_warmup():
        while True:
            await asyncio.sleep(600)  # every 10 minutes
            try:
                from app.services.opensearch_service import get_opensearch_service
                from app.services.embedding_service import get_embedding_service
                os_svc = get_opensearch_service()
                emb_svc = get_embedding_service()
                probe_vec = emb_svc.embed("technology companies in india")
                probe_body = {
                    "size": 1,
                    "_source": ["name"],
                    "query": {
                        "knn": {
                            "vector_embedding": {
                                "vector": probe_vec,
                                "k": 1,
                            }
                        }
                    },
                }
                resp = os_svc.search(
                    index=settings.OPENSEARCH_INDEX_NAME,
                    body=probe_body,
                    size=1,
                )
                hits = resp.get("hits", {}).get("total", {}).get("value", 0)
                logger.info("semantic_warmup_probe_ok", hits=hits)
            except Exception as exc:
                logger.warning("periodic_semantic_probe_failed", error=str(exc))

    warmup_task = asyncio.create_task(_periodic_warmup())

    logger.info("startup_complete", timestamp=time.time())
    
    yield
    
    # ========== Shutdown ==========
    warmup_task.cancel()
    logger.info("application_shutdown", timestamp=time.time())


def get_application() -> FastAPI:
    """
    Create and configure the FastAPI application.
    """
    settings = get_settings()
    
    app = FastAPI(
        title=settings.API_TITLE,
        description="""
        ## Intelligent Company Search API (v2.0)
        
        Revolutionary AI-powered search with automatic intent classification and intelligent routing.
        
        ### Key Features
        
        **1. Intent Classification** 🧠
        - Automatically classifies queries into 3 buckets using GPT-4o-mini
        - Regular (Exact Match), Semantic (Conceptual), Agentic (External Data)
        - Powered by Instructor for deterministic outputs
        
        **2. Hybrid Search** 🔍
        - **Regular**: Fast BM25 lexical search for exact matches
        - **Semantic**: Vector k-NN with Reciprocal Rank Fusion (RRF)
        - **Agentic**: External tools (news, funding, events)
        
        **3. Observability** 📊
        - OpenTelemetry tracing and metrics (OTLP → OTel Collector → Jaeger/Prometheus)
        - Response headers expose search logic and confidence scores
        - Detailed execution metadata for every query
        
        ### Quick Examples
        
        **Regular Query:**
        ```json
        POST /api/search/intelligent
        {
            "query": "Apple Inc",
            "limit": 10
        }
        ```
        
        **Semantic Query:**
        ```json
        POST /api/search/intelligent
        {
            "query": "sustainable energy companies in Europe",
            "limit": 20
        }
        ```
        
        **Agentic Query:**
        ```json
        POST /api/search/intelligent
        {
            "query": "tech companies that raised funding recently",
            "limit": 15
        }
        ```
        
        ### Response Headers
        - `X-Trace-ID`: Unique request identifier
        - `X-Search-Logic`: Which search method was used
        - `X-Confidence`: Classification confidence (0.0-1.0)
        - `X-Response-Time-MS`: Total execution time
        - `X-Total-Results`: Number of results returned
        """,
        version=settings.API_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=lifespan
    )
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Add request ID middleware for tracing
    @app.middleware("http")
    async def add_trace_id(request: Request, call_next):
        """Add trace ID to every request for observability"""
        trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4())[:12])
        request.state.trace_id = trace_id
        
        response = await call_next(request)
        response.headers["X-Trace-ID"] = trace_id
        return response
    
    # Add timing middleware
    @app.middleware("http")
    async def timing_middleware(request: Request, call_next):
        """Track request timing"""
        start_time = time.time()
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        response.headers["X-Process-Time-MS"] = str(int(process_time))
        return response
    
    # OTel FastAPI instrumentation — must happen before the app starts serving
    from app.observability import instrument_fastapi
    instrument_fastapi(app)

    # Include routes
    app.include_router(routes.router)
    
    # Error handlers
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.error(
            "unhandled_exception",
            path=request.url.path,
            error=str(exc),
            trace_id=getattr(request.state, "trace_id", "unknown")
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal server error",
                "trace_id": getattr(request.state, "trace_id", "unknown")
            }
        )
    
    @app.get("/health", tags=["diagnostics"])
    async def health():
        """Lightweight health check for ALB/container probes"""
        return {"status": "healthy"}

    @app.get("/", tags=["root"])
    async def root():
        """API root endpoint with metadata"""
        settings = get_settings()
        return {
            "service": "Intelli-Search Intelligent Search",
            "version": settings.API_VERSION,
            "environment": settings.ENVIRONMENT,
            "docs_url": "/docs",
            "health_check": "/health",
            "features_info": "/api/search/features"
        }
    
    return app


# Create the application instance
app = get_application()
