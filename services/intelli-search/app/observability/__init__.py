"""
OpenTelemetry observability package.

Usage in lifespan:
    from app.observability import configure_logging, configure_tracing, configure_metrics, instrument_fastapi
    configure_logging()
    configure_tracing(service_name, otlp_endpoint)
    configure_metrics(service_name, otlp_endpoint)
    instrument_fastapi(app)

Usage in services:
    from app.observability import get_tracer, get_search_metrics, generate_trace_id
    tracer = get_tracer(__name__)
    metrics = get_search_metrics()
    metrics["search_requests_total"].add(1, {"query_type": "semantic"})
    trace_id = generate_trace_id()
"""
from app.observability.logging import configure_logging, configure_log_export, generate_trace_id, RequestLoggingMiddleware
from app.observability.tracing import configure_tracing, get_tracer, instrument_fastapi
from app.observability.metrics import configure_metrics, get_search_metrics
from app.observability.events import log_search_classification, log_search_execution

__all__ = [
    "configure_logging",
    "configure_log_export",
    "generate_trace_id",
    "RequestLoggingMiddleware",
    "configure_tracing",
    "get_tracer",
    "instrument_fastapi",
    "configure_metrics",
    "get_search_metrics",
    "log_search_classification",
    "log_search_execution",
]
