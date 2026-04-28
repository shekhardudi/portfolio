"""
Tests for SearchOrchestrator.

Verifies that the orchestrator correctly routes queries to strategies,
builds the expected response shape, and handles fallback/edge cases.
"""
import pytest
from unittest.mock import MagicMock, patch

from app.services.intent_classifier import QueryIntent, SearchIntent
from app.services.search_strategies import SearchResult, EventData


def _make_intent(category: str = "regular", confidence: float = 0.95) -> QueryIntent:
    return QueryIntent(
        category=SearchIntent(category),
        confidence=confidence,
        filters={},
        search_query="test query",
        needs_external_data=False,
        external_data_type=None,
        field_boosts={},
        reasoning="test",
    )


def _make_search_result(**overrides) -> SearchResult:
    defaults = dict(
        company_id="c1",
        company_name="Acme Corp",
        domain="acme.com",
        industry="technology",
        country="US",
        locality="San Francisco",
        relevance_score=0.9,
        search_method="bm25",
        ranking_source="bm25",
        matching_reason="name match",
        year_founded=2010,
        size_range="51-200",
        current_employee_estimate=100,
        event_data=None,
        linkedin_profile=None,
    )
    defaults.update(overrides)
    return SearchResult(**defaults)


@pytest.fixture
def orchestrator():
    """Construct a real SearchOrchestrator with all dependencies mocked."""
    with patch("app.services.orchestrator.get_intent_classifier") as mock_cls, \
         patch("app.services.orchestrator.get_embedding_service") as mock_emb, \
         patch("app.services.orchestrator.get_opensearch_service") as mock_os, \
         patch("app.services.orchestrator.get_cache_service") as mock_cache, \
         patch("app.services.orchestrator.ToolService") as mock_tool_svc, \
         patch("app.services.orchestrator.RegularSearchStrategy") as mock_reg, \
         patch("app.services.orchestrator.SemanticSearchStrategy") as mock_sem, \
         patch("app.services.orchestrator.AgenticSearchStrategy") as mock_age:

        mock_classifier = MagicMock()
        mock_cls.return_value = mock_classifier
        mock_classifier.classify.return_value = _make_intent("regular")

        mock_cache_inst = MagicMock()
        mock_cache_inst.get.return_value = None  # no cache hit
        mock_cache.return_value = mock_cache_inst

        for Strat in (mock_reg, mock_sem, mock_age):
            Strat.return_value.search.return_value = (
                [_make_search_result()],
                {"score_range": {"min": 0.5, "max": 1.0}},
            )
            Strat.return_value.get_strategy_type.return_value = "mock"

        from app.services.orchestrator import SearchOrchestrator
        orch = SearchOrchestrator()
        yield orch, mock_classifier, mock_reg.return_value, mock_sem.return_value, mock_age.return_value


def test_regular_query_routes_to_regular_strategy(orchestrator):
    orch, classifier, regular_strat, _, _ = orchestrator
    classifier.classify.return_value = _make_intent("regular")
    result = orch.search("Apple Inc", limit=10, page=1)
    regular_strat.search.assert_called_once()
    assert result.intent["category"] == "regular"


def test_semantic_query_routes_to_semantic_strategy(orchestrator):
    orch, classifier, _, semantic_strat, _ = orchestrator
    classifier.classify.return_value = _make_intent("semantic", 0.88)
    result = orch.search("sustainable energy companies Europe", limit=10, page=1)
    semantic_strat.search.assert_called_once()
    assert result.intent["category"] == "semantic"


def test_agentic_query_routes_to_agentic_strategy(orchestrator):
    orch, classifier, _, _, agentic_strat = orchestrator
    classifier.classify.return_value = _make_intent("agentic", 0.92)
    result = orch.search("companies that raised Series A recently", limit=10, page=1)
    agentic_strat.search.assert_called_once()
    assert result.intent["category"] == "agentic"


def test_response_has_required_fields(orchestrator):
    orch, classifier, _, _, _ = orchestrator
    classifier.classify.return_value = _make_intent("regular")
    result = orch.search("Apple", limit=5, page=1)
    assert hasattr(result, "results")
    assert hasattr(result, "intent")
    assert hasattr(result, "trace_id")
    assert hasattr(result, "metadata")
    assert hasattr(result, "response_headers")


def test_results_respect_limit(orchestrator):
    """Orchestrator passes limit to strategy via SearchContext; strategy enforces it."""
    orch, classifier, regular_strat, _, _ = orchestrator
    classifier.classify.return_value = _make_intent("regular")
    regular_strat.search.return_value = (
        [_make_search_result()] * 10,
        {"score_range": {}},
    )
    result = orch.search("Apple", limit=10, page=1)
    called_ctx = regular_strat.search.call_args[0][0]
    assert called_ctx.limit == 10
    assert len(result.results) == 10


def test_format_result_maps_company_id_to_id(orchestrator):
    """_format_result renames company_id to id for the API response."""
    orch, *_ = orchestrator
    result = orch.search("Apple", limit=10, page=1)
    assert "id" in result.results[0]
    assert result.results[0]["id"] == "c1"


def test_format_result_includes_event_data(orchestrator):
    orch, classifier, regular_strat, _, _ = orchestrator
    classifier.classify.return_value = _make_intent("regular")
    sr = _make_search_result(
        event_data=EventData(event_type="funding", amount="$10M", round="Series A"),
    )
    regular_strat.search.return_value = ([sr], {"score_range": {"min": 0.5, "max": 1.0}})
    result = orch.search("funded companies", limit=10, page=1)
    assert result.results[0]["event_data"]["event_type"] == "funding"


def test_format_result_includes_linkedin_profile(orchestrator):
    orch, classifier, regular_strat, _, _ = orchestrator
    classifier.classify.return_value = _make_intent("regular")
    sr = _make_search_result(
        linkedin_profile={"url": "https://linkedin.com/company/acme", "followers": 5000},
    )
    regular_strat.search.return_value = ([sr], {"score_range": {"min": 0.5, "max": 1.0}})
    result = orch.search("Acme Corp", limit=10, page=1)
    assert result.results[0]["linkedin_profile"]["url"] == "https://linkedin.com/company/acme"


def test_classification_failure_falls_back_to_semantic(orchestrator):
    orch, classifier, _, semantic_strat, _ = orchestrator
    classifier.classify.side_effect = Exception("LLM down")
    result = orch.search("some ambiguous query", limit=10, page=1)
    # The regex pre-classifier won't match a generic query → falls through to LLM
    # LLM raises → orchestrator catches and builds a SEMANTIC fallback intent
    semantic_strat.search.assert_called_once()
    assert result.intent["category"] == "semantic"


def test_strategy_failure_falls_back_to_semantic(orchestrator):
    orch, classifier, regular_strat, semantic_strat, _ = orchestrator
    classifier.classify.return_value = _make_intent("regular")
    regular_strat.search.side_effect = Exception("OpenSearch down")
    result = orch.search("Apple Inc", limit=10, page=1)
    semantic_strat.search.assert_called()
