"""
OpenTelemetry tracing setup.

Registers a global TracerProvider that exports spans via OTLP/gRPC.
Call configure_tracing() once at startup (before serving requests).

If the OTLP collector is unreachable at startup the function silently installs
a no-op provider so the app starts cleanly with no retry spam.
"""
import structlog
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource, SERVICE_NAME

logger = structlog.get_logger(__name__)


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


def configure_tracing(service_name: str, otlp_endpoint: str) -> None:
    """
    Set up OTLP/gRPC span exporter and install as the global TracerProvider.
    Falls back to a no-op provider when the collector is unreachable.

    Args:
        service_name: Logical service name embedded in every span.
        otlp_endpoint: OTLP collector gRPC address, e.g. "http://otel-collector:4317".
    """
    resource = Resource.create({SERVICE_NAME: service_name})

    if not _is_grpc_endpoint_reachable(otlp_endpoint):
        logger.warning(
            "otel_collector_unreachable_tracing_disabled",
            endpoint=otlp_endpoint,
            hint="Start an OTel Collector to enable distributed tracing.",
        )
        # Install a real TracerProvider with no exporters — spans are created
        # in-process but never shipped, and no background thread retries.
        trace.set_tracer_provider(TracerProvider(resource=resource))
        return

    try:
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        logger.info("tracing_configured", service=service_name, endpoint=otlp_endpoint)
    except Exception as exc:
        # Tracing is non-fatal — app continues without it.
        logger.warning("tracing_configuration_failed", error=str(exc))


def get_tracer(name: str) -> trace.Tracer:
    """Return a tracer scoped to *name* (typically ``__name__``)."""
    return trace.get_tracer(name)


def instrument_fastapi(app) -> None:
    """
    Attach OTel auto-instrumentation to a FastAPI app.
    Must be called after configure_tracing().
    """
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app)
        logger.info("fastapi_instrumentation_applied")
    except Exception as exc:
        logger.warning("fastapi_instrumentation_failed", error=str(exc))
