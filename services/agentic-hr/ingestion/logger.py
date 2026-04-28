"""
Central logging configuration for the ingestion pipeline.

Usage:
    from logger import get_logger
    log = get_logger(__name__)
"""
import logging
import os
import sys

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def configure_logging() -> None:
    """Call once at the top of ingest.py main()."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))
    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)
    root.addHandler(handler)
    logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
