"""
Structured logging configuration and HTTP request logging middleware.

Logs are sent to both the local console (structlog JSON) and, when an OTel
Collector is reachable, to the OTLP/gRPC log exporter so they appear in
your observability backend alongside traces and metrics.
"""
import time
import uuid
import logging
import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


def generate_trace_id() -> str:
    """Generate a short, URL-safe trace ID (12 hex chars).

    Used everywhere a new trace needs to be minted — orchestrator, classifier,
    and the HTTP middleware when no ``X-Trace-ID`` header is provided.
    Client-supplied ``X-Trace-ID`` header values are always passed through
    unchanged regardless of their format.
    """
    return uuid.uuid4().hex[:12]


def configure_logging(level: str = "INFO") -> None:
    """Configure structlog for JSON output with standard processors."""
    import logging
    logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO))
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer(),
        ],
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def configure_log_export(service_name: str, otlp_endpoint: str, level: str = "INFO") -> None:
    """Attach an OTLP/gRPC log exporter to the root logger.

    Call once at startup AFTER configure_logging().  Follows the same
    reachability-check pattern used by configure_tracing / configure_metrics
    so the app starts cleanly when no collector is available.

    If the collector is reachable but does not implement the logs service
    (returns gRPC UNIMPLEMENTED), log export is silently disabled so the
    app is never blocked or spammed with retry errors.
    """
    _logger = structlog.get_logger(__name__)

    if not _is_grpc_endpoint_reachable(otlp_endpoint):
        _logger.warning(
            "otel_collector_unreachable_log_export_disabled",
            endpoint=otlp_endpoint,
            hint="Start an OTel Collector to enable log export.",
        )
        return

    try:
        from opentelemetry.sdk.resources import Resource, SERVICE_NAME
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import (
            BatchLogRecordProcessor,
            SimpleLogRecordProcessor,
            LogExportResult,
        )
        from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
        from opentelemetry._logs import set_logger_provider

        # Silence the OTLP exporter's own logger so failed exports never
        # spam the console or interfere with app startup.
        logging.getLogger("opentelemetry.exporter.otlp.proto.grpc.exporter").setLevel(
            logging.CRITICAL
        )

        resource = Resource.create({SERVICE_NAME: service_name})
        log_exporter = OTLPLogExporter(endpoint=otlp_endpoint, insecure=True)

        # Probe: send a single empty batch to detect UNIMPLEMENTED early.
        # SimpleLogRecordProcessor is used only for this probe; the real
        # pipeline uses BatchLogRecordProcessor.
        probe_result = log_exporter.export([])
        if probe_result is not LogExportResult.SUCCESS:
            _logger.warning(
                "otel_log_export_not_supported",
                endpoint=otlp_endpoint,
                result=str(probe_result),
                hint="Collector responded but does not support the logs signal. "
                     "Enable an OTLP logs receiver in your collector config.",
            )
            log_exporter.shutdown()
            return

        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))
        set_logger_provider(logger_provider)

        # Attach an OTel LoggingHandler to the root logger so every stdlib
        # log record (including structlog output) is forwarded to the collector.
        otel_handler = LoggingHandler(
            level=getattr(logging, level.upper(), logging.DEBUG),
            logger_provider=logger_provider,
        )
        logging.getLogger().addHandler(otel_handler)

        _logger.info("log_export_configured", service=service_name, endpoint=otlp_endpoint)
    except Exception as exc:
        # Non-fatal — app continues with console-only logging.
        _logger.warning("log_export_configuration_failed", error=str(exc))


def _is_grpc_endpoint_reachable(
    endpoint: str, retries: int = 3, timeout: float = 2.0
) -> bool:
    """TCP probe to see if the OTLP gRPC endpoint is accepting connections."""
    import socket
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


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Logs every HTTP request with method, path, status, and duration."""

    _log = structlog.get_logger(__name__)

    async def dispatch(self, request: Request, call_next):
        trace_id = request.headers.get("X-Trace-ID") or generate_trace_id()
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = int((time.perf_counter() - start) * 1000)
        self._log.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=duration_ms,
            trace_id=trace_id,
        )
        response.headers["X-Trace-ID"] = trace_id
        return response
