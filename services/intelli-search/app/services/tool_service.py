"""
Tool Service — thin adapter between AgenticSearchStrategy and AgentService.

AgenticSearchStrategy calls `tool_service.call(data_type, query)`.
This class delegates to the LangChain-based AgentService and returns
results in the OpenSearch-hit format that the strategy already understands.
"""
import structlog
from typing import Any, Optional

from app.config import get_settings, get_search_config
from app.services.agent_service import AgentService

logger = structlog.get_logger(__name__)


class ToolService:
    """
    Adapter that exposes the LangChain agent through the
    `call(data_type, query) -> list[dict]` interface used by
    AgenticSearchStrategy.
    """

    def __init__(
        self,
        opensearch_service: Any,
        openai_api_key: str,
        model: str,
        tavily_key: Optional[str],
        max_iterations: int,
    ) -> None:
        self._agent = AgentService(
            opensearch_service=opensearch_service,
            openai_api_key=openai_api_key,
            model=model,
            tavily_key=tavily_key,
            max_iterations=max_iterations,
        )

    def call(
        self,
        data_type: str,
        query: str,
        progress_callback: Optional[Any] = None,
    ) -> list[dict[str, Any]]:
        """
        Entry point called by AgenticSearchStrategy.
        Returns a list of OpenSearch-hit-format dicts, each optionally
        annotated with a _event_data dict.

        Args:
            data_type: Type of external data requested (e.g. 'news', 'funding').
            query: The user's search query.
            progress_callback: Optional callable(phase: str, message: str) invoked
                during the agent run to emit real-time progress events for SSE streaming.
        """
        logger.info("tool_service_call", data_type=data_type, query=query[:100])
        return self._agent.run(query, progress_callback=progress_callback)
