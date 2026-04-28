"""
Search event logging functions.

Module-level replacements for the methods that were on ObservabilityService.
Callers import directly:

    from app.observability import log_search_classification, log_search_execution
"""
import structlog
from typing import Dict, Any

logger = structlog.get_logger(__name__)


def log_search_classification(
    trace_id: str,
    query: str,
    category: str,
    confidence: float,
    reasoning: str,
) -> None:
    """Log query classification for observability."""
    logger.info(
        "query_classified",
        trace_id=trace_id,
        query=query[:100],
        category=category,
        confidence=confidence,
        reasoning=reasoning,
    )


def log_search_execution(
    trace_id: str,
    strategy: str,
    query: str,
    total_results: int,
    execution_time_ms: int,
    score_info: Dict[str, Any],
) -> None:
    """Log search execution details and record OTel metrics.

    Never raises — observability must not break the search path.
    """
    logger.info(
        "search_executed",
        trace_id=trace_id,
        strategy=strategy,
        query=query[:100],
        total_results=total_results,
        execution_time_ms=execution_time_ms,
        **score_info,
    )

    try:
        from app.observability.metrics import get_search_metrics
        m = get_search_metrics()
        attrs = {"query_type": strategy or "unknown"}
        m["search_latency_ms"].record(execution_time_ms, attrs)
        if total_results == 0:
            m["zero_result_queries_total"].add(1, attrs)
    except Exception:
        pass
