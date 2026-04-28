"""
Lightweight observability helpers for the data-pipeline.

Intentionally self-contained — no OpenTelemetry, no backend imports.
The pipeline runs as a standalone script (potentially on a separate machine),
so this file must have zero cross-service dependencies.

Provides:
  - configure_logging(level)  — JSON structlog output, same format as the backend
  - generate_trace_id()       — 12-char hex ID, same format as the backend
"""
import uuid
import structlog


def generate_trace_id() -> str:
    """Generate a short, URL-safe trace ID (12 hex chars).

    Same format as ``app.observability.generate_trace_id`` in the backend so
    IDs are visually consistent across ingestion logs and search logs.
    """
    return uuid.uuid4().hex[:12]


def configure_logging(level: str = "INFO") -> None:
    """Configure structlog for JSON output.

    Mirrors the backend's ``app.observability.configure_logging`` so that
    ingestion logs land in the same aggregator with the same field schema.
    """
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
