"""
OpenTelemetry metrics setup.

Registers a global MeterProvider that exports via OTLP/gRPC.
Call configure_metrics() once at startup.

Instruments are created lazily on first call to get_search_metrics() so they
always bind to whichever MeterProvider is currently installed (NoOp before
configure_metrics() is called, real provider after).

If the OTLP collector is unreachable at startup the function silently installs
a no-op provider so the app starts cleanly with no retry spam.
"""
import structlog
from typing import Any, Dict
from opentelemetry import metrics
from opentelemetry.sdk.resources import Resource, SERVICE_NAME

logger = structlog.get_logger(__name__)

_INSTRUMENTS: Dict[str, Any] = {}


def _is_grpc_endpoint_reachable(
    endpoint: str, retries: int = 3, timeout: float = 2.0
) -> bool:
    """TCP probe to see if the OTLP gRPC endpoint is accepting connections.

    Retries up to *retries* times with a 1-second delay between attempts so
    that ECS sidecar containers (ADOT collector) have time to start alongside
    the app container without permanently disabling telemetry.
    """
    import socket
    import time
    import urllib.parse
    parsed = urllib.parse.urlparse(endpoint)
    host = parsed.hostname or "localhost"
    port = parsed.port or 4317
    for attempt in range(retries):
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except OSError:
            if attempt < retries - 1:
                time.sleep(1)
    return False


def configure_metrics(service_name: str, otlp_endpoint: str) -> None:
    """
    Set up OTLP/gRPC metric exporter and install as the global MeterProvider.
    Falls back to a no-op provider when the collector is unreachable.

    Args:
        service_name: Logical service name embedded in every metric.
        otlp_endpoint: OTLP collector gRPC address, e.g. "http://otel-collector:4317".
    """
    resource = Resource.create({SERVICE_NAME: service_name})

    if not _is_grpc_endpoint_reachable(otlp_endpoint):
        logger.warning(
            "otel_collector_unreachable_metrics_disabled",
            endpoint=otlp_endpoint,
            hint="Start an OTel Collector to enable metrics export.",
        )
        # Install a real MeterProvider with no readers — instruments work but
        # nothing is exported, and there are no background retry threads.
        from opentelemetry.sdk.metrics import MeterProvider
        metrics.set_meter_provider(MeterProvider(resource=resource))
        return

    try:
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter

        exporter = OTLPMetricExporter(endpoint=otlp_endpoint, insecure=True)
        reader = PeriodicExportingMetricReader(exporter, export_interval_millis=30_000)
        provider = MeterProvider(resource=resource, metric_readers=[reader])
        metrics.set_meter_provider(provider)
        logger.info("metrics_configured", service=service_name, endpoint=otlp_endpoint)
    except Exception as exc:
        logger.warning("metrics_configuration_failed", error=str(exc))


def get_search_metrics() -> Dict[str, Any]:
    """
    Return (and lazily create) the shared set of search metric instruments.

    Thread-safe: instruments are idempotent once created and the dict is only
    written once (GIL prevents double-init under normal import semantics).
    """
    global _INSTRUMENTS
    if _INSTRUMENTS:
        return _INSTRUMENTS

    meter = metrics.get_meter("intelli_search")
    _INSTRUMENTS = {
        # Counters
        "search_requests_total": meter.create_counter(
            name="search_requests_total",
            description="Total search requests by endpoint, query_type, and cache_hit.",
            unit="1",
        ),
        "zero_result_queries_total": meter.create_counter(
            name="zero_result_queries_total",
            description="Queries that returned zero results.",
            unit="1",
        ),
        "llm_calls_total": meter.create_counter(
            name="llm_calls_total",
            description="Total LLM API calls by model and status.",
            unit="1",
        ),
        # UpDownCounters
        "active_search_requests": meter.create_up_down_counter(
            name="active_search_requests",
            description="Number of search requests currently in-flight.",
            unit="1",
        ),
        # Histograms
        "search_latency_ms": meter.create_histogram(
            name="search_latency_ms",
            description="End-to-end search latency in milliseconds.",
            unit="ms",
        ),
        "opensearch_query_duration_ms": meter.create_histogram(
            name="opensearch_query_duration_ms",
            description="OpenSearch query execution time in milliseconds.",
            unit="ms",
        ),
        "llm_latency_ms": meter.create_histogram(
            name="llm_latency_ms",
            description="LLM API call latency in milliseconds.",
            unit="ms",
        ),
    }
    return _INSTRUMENTS
