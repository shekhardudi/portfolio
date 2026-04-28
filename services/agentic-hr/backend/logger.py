"""
Central logging configuration for the Agentic HR backend.

Usage in any module:
    from logger import get_logger
    log = get_logger(__name__)
"""
import logging
import os
import sys

_CONFIGURED = False

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def configure_logging() -> None:
    """Call once at application startup (main.py lifespan)."""
    global _CONFIGURED
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))
    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)
    root.addHandler(handler)
    # Quiet noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_guardrail_event(
    logger: logging.Logger,
    action: str,
    category: str,
    session_id: str = None,
    metadata: dict = None,
) -> None:
    """Log a structured guardrail event.
    
    Args:
        logger: Logger instance to use
        action: Guardrail action (allow/warn/block/redact)
        category: Event category (inbound/prompt/response/audit)
        session_id: Optional session ID for tracing
        metadata: Optional dict with additional metadata
    """
    msg_parts = [f"Guardrail event | action={action} | category={category}"]
    if session_id:
        msg_parts.append(f"| session={session_id}")
    if metadata:
        for key, value in metadata.items():
            msg_parts.append(f"| {key}={value}")
    
    message = " ".join(msg_parts)
    
    # Log as INFO for blocks/warnings, DEBUG for allow
    if action in ("block", "warn", "redact"):
        logger.warning(message)
    else:
        logger.debug(message)
