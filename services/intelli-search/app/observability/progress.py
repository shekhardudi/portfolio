"""
Canonical SSE / progress phase names emitted by orchestrator, strategies,
and the agentic pipeline. The wire format is plain strings (each enum is a
``str`` subclass), so existing callers using bare strings keep working — but
new code SHOULD import from here for typo-safety and discoverability.
"""
from enum import Enum


class ProgressEvent(str, Enum):
    """Phase identifier sent over the SSE ``progress`` channel."""

    CLASSIFICATION = "classification"
    SEARCHING = "searching"
    EXTRACTING = "extracting"
    RESOLVING = "resolving"
    ENRICHING = "enriching"
    FALLBACK = "fallback"
    EMBEDDING = "embedding"
    VECTOR_SEARCH = "vector_search"
    DONE = "done"
    ERROR = "error"
