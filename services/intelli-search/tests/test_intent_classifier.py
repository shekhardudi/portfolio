"""Tests for IntentClassifier — classification logic, caching, and fallback."""
import pytest
from unittest.mock import MagicMock, patch


def _make_query_intent(category="regular", confidence=0.95):
    from app.services.intent_classifier import QueryIntent, SearchIntent
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


@pytest.fixture
def classifier(mock_openai):
    with patch("app.services.intent_classifier._PROMPT_PATH") as mock_path:
        mock_path.read_text.return_value = "You are a test assistant."
        # Re-import after patching won't help; patch the module-level constant instead
        pass
    with patch("app.services.intent_classifier._SYSTEM_PROMPT", "You are a test assistant."):
        from app.services.intent_classifier import IntentClassifier
        return IntentClassifier()


def test_classify_returns_query_intent(classifier, mock_openai):
    intent = _make_query_intent("semantic", 0.9)
    mock_openai.chat.completions.create.return_value = intent

    result = classifier.classify("sustainable tech companies Europe")
    assert result.category.value == "semantic"
    assert result.confidence == 0.9


def test_classify_caches_result(classifier, mock_openai):
    intent = _make_query_intent("regular", 0.98)
    mock_openai.chat.completions.create.return_value = intent

    _ = classifier.classify("Apple Inc")
    _ = classifier.classify("Apple Inc")

    # LLM should only have been called once
    assert mock_openai.chat.completions.create.call_count == 1


def test_classify_cache_key_is_lowercased(classifier, mock_openai):
    intent = _make_query_intent("regular", 0.98)
    mock_openai.chat.completions.create.return_value = intent

    classifier.classify("APPLE INC")
    classifier.classify("apple inc")

    assert mock_openai.chat.completions.create.call_count == 1


def test_classify_empty_query_returns_regular(classifier):
    result = classifier.classify("")
    assert result.category.value == "regular"
    assert result.search_query == ""
    assert result.confidence == 1.0


def test_classify_fallback_on_llm_error(classifier, mock_openai):
    mock_openai.chat.completions.create.side_effect = Exception("LLM timeout")

    result = classifier.classify("some query")
    # Fallback must be semantic with low confidence
    assert result.category.value == "semantic"
    assert result.confidence <= 0.5
    assert result.search_query == "some query"


def test_cache_is_bounded(classifier, mock_openai):
    mock_openai.chat.completions.create.side_effect = (
        _make_query_intent("regular") for _ in range(1000)
    )
    # Fill beyond maxsize — should not raise
    for i in range(classifier._cache_maxsize + 10):
        mock_openai.chat.completions.create.return_value = _make_query_intent("regular")
        classifier.classify(f"unique query {i}")

    assert len(classifier._classify_cache) <= classifier._cache_maxsize


def test_classify_accepts_trace_id(classifier, mock_openai):
    intent = _make_query_intent("regular", 0.95)
    mock_openai.chat.completions.create.return_value = intent
    # Should not raise
    result = classifier.classify("test query", trace_id="t-123")
    assert result.category.value == "regular"
