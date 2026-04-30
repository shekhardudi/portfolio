"""
Tests for AgenticPipeline — the deterministic async pipeline.

Locks the current behaviour before the LangChain removal refactor so we have
a safety net while collapsing the agentic path.
"""
import asyncio
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _intent(search_query: str = "AI startups funding"):
    """Build a minimal QueryIntent for the pipeline."""
    from app.services.intent_classifier import QueryIntent, SearchIntent
    return QueryIntent(
        category=SearchIntent.AGENTIC,
        confidence=0.9,
        filters={},
        search_query=search_query,
        needs_external_data=True,
        external_data_type="funding",
        field_boosts={},
        reasoning="test",
    )


def _tavily_response(*urls: str) -> dict:
    return {
        "results": [
            {
                "title": f"Headline {i}",
                "url": u,
                "content": f"Body content for {u}",
                "published_date": "2026-04-01",
            }
            for i, u in enumerate(urls)
        ]
    }


def _make_pipeline(*, embeddings=None, tavily_key="tav-test-key", cache=None,
                   resolve_to_index: bool = True):
    """Build a pipeline with sane test defaults (overrides config-driven flags)."""
    from app.services.agentic_pipeline import AgenticPipeline
    mock_os = MagicMock()
    pipeline = AgenticPipeline(
        opensearch_service=mock_os,
        openai_api_key="sk-test-key",
        tavily_key=tavily_key,
        cache_service=cache,
        embedding_service=embeddings,
    )
    pipeline._resolve_to_index = resolve_to_index
    pipeline._min_resolve_score = 0.5
    return pipeline, mock_os


def _llm_completion(json_payload: str, *, finish_reason: str = "stop"):
    """Build a mock OpenAI ChatCompletion response object."""
    msg = SimpleNamespace(content=json_payload)
    choice = SimpleNamespace(message=msg, finish_reason=finish_reason)
    usage = SimpleNamespace(prompt_tokens=10, completion_tokens=20)
    return SimpleNamespace(choices=[choice], usage=usage)


def _msearch_response(*per_event_hits: list[dict]) -> dict:
    return {
        "responses": [
            {"hits": {"hits": hits}} for hits in per_event_hits
        ]
    }


def _hit(_id: str, name: str, score: float = 5.0) -> dict:
    return {
        "_id": _id,
        "_score": score,
        "_source": {
            "name": name,
            "domain": f"{name.lower().replace(' ', '')}.com",
            "industry": "tech",
            "country": "US",
            "locality": "SF",
        },
    }


# ---------------------------------------------------------------------------
# Happy path — tavily → extract → batch resolve
# ---------------------------------------------------------------------------

class TestAgenticPipelineHappyPath:
    def test_returns_enriched_docs_with_event_data(self):
        pipeline, mock_os = _make_pipeline()

        events_json = (
            '{"events": [{"company_name": "FundedCo", "event_type": "funding", '
            '"amount": "$50M", "round": "Series B", "date": "2026-04-01", '
            '"summary": "Raised $50M Series B", "source_url": "https://news/x"}]}'
        )
        mock_os.client.msearch.return_value = _msearch_response(
            [_hit("c-funded", "FundedCo")]
        )

        with patch.object(pipeline._search, "asearch",
                   new=AsyncMock(return_value=_tavily_response("https://news/x"))), \
             patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(return_value=_llm_completion(events_json))):
            results = asyncio.run(pipeline.run("AI funding", _intent()))

        assert len(results) == 1
        r = results[0]
        assert r["_id"] == "c-funded"
        assert r["name"] == "FundedCo"
        assert r["_event_data"]["event_type"] == "funding"
        assert r["_event_data"]["amount"] == "$50M"

    def test_msearch_called_once_for_batch_resolve(self):
        pipeline, mock_os = _make_pipeline()
        events_json = (
            '{"events": ['
            '{"company_name": "A", "event_type": "funding", "summary": "x"},'
            '{"company_name": "B", "event_type": "funding", "summary": "y"}'
            ']}'
        )
        mock_os.client.msearch.return_value = _msearch_response(
            [_hit("a1", "A")], [_hit("b1", "B")]
        )
        with patch.object(pipeline._search, "asearch",
                   new=AsyncMock(return_value=_tavily_response("https://u/1"))), \
             patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(return_value=_llm_completion(events_json))):
            asyncio.run(pipeline.run("AI funding", _intent()))

        assert mock_os.client.msearch.call_count == 1


# ---------------------------------------------------------------------------
# Truncated extraction → recover_partial_events
# ---------------------------------------------------------------------------

class TestAgenticPipelineTruncatedExtraction:
    def test_recovers_partial_events_on_length_finish(self):
        pipeline, mock_os = _make_pipeline()
        # Truncated JSON: one full event + opening of second one
        truncated = (
            '{"events": ['
            '{"company_name": "PartialCo", "event_type": "funding", "summary": "ok"},'
            '{"company_name": "Half'
        )
        mock_os.client.msearch.return_value = _msearch_response(
            [_hit("p1", "PartialCo")]
        )
        with patch.object(pipeline._search, "asearch",
                   new=AsyncMock(return_value=_tavily_response("https://u/1"))), \
             patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(return_value=_llm_completion(
                              truncated, finish_reason="length"))):
            results = asyncio.run(pipeline.run("AI funding", _intent()))

        assert len(results) >= 1
        assert results[0]["name"] == "PartialCo"


# ---------------------------------------------------------------------------
# Empty Tavily hits → semantic prefetch fallback
# ---------------------------------------------------------------------------

class TestAgenticPipelineSemanticFallback:
    def test_empty_tavily_uses_semantic_prefetch(self):
        embeddings = MagicMock()
        embeddings.embed.return_value = [0.0] * 384
        pipeline, mock_os = _make_pipeline(embeddings=embeddings)

        # First call (semantic prefetch via OpenSearch.search) returns hits
        mock_os.search.return_value = {
            "hits": {"hits": [_hit("sem-1", "SemanticCo", score=0.8)]}
        }

        with patch.object(pipeline._search, "asearch",
                   new=AsyncMock(return_value={"results": []})):
            results = asyncio.run(pipeline.run("clean energy companies", _intent()))

        assert len(results) == 1
        assert results[0]["name"] == "SemanticCo"
        # Semantic search was used (not msearch)
        mock_os.search.assert_called()


# ---------------------------------------------------------------------------
# resolve_to_index=False → all results synthetic
# ---------------------------------------------------------------------------

class TestAgenticPipelineResolveToIndexFalse:
    def test_skips_msearch_and_returns_synthetic(self):
        pipeline, mock_os = _make_pipeline(resolve_to_index=False)

        events_json = (
            '{"events": ['
            '{"company_name": "SyntheticCo", "event_type": "funding", '
            '"summary": "Raised", "country": "US", "city": "NYC"}'
            ']}'
        )
        with patch.object(pipeline._search, "asearch",
                   new=AsyncMock(return_value=_tavily_response("https://u/1"))), \
             patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(return_value=_llm_completion(events_json))):
            results = asyncio.run(pipeline.run("AI funding", _intent()))

        assert len(results) == 1
        assert results[0]["_id"].startswith("synthetic_")
        assert results[0]["name"] == "SyntheticCo"
        assert results[0]["country"] == "US"
        # msearch must NOT have been called
        mock_os.client.msearch.assert_not_called()


# ---------------------------------------------------------------------------
# Mixed found / not-found in msearch → both indexed and synthetic in output
# ---------------------------------------------------------------------------

class TestAgenticPipelineMixedResolution:
    def test_unmatched_companies_become_synthetic(self):
        pipeline, mock_os = _make_pipeline()
        events_json = (
            '{"events": ['
            '{"company_name": "FoundCo", "event_type": "funding", "summary": "x"},'
            '{"company_name": "MissingCo", "event_type": "funding", "summary": "y"}'
            ']}'
        )
        # First event matches; second event has no msearch hits
        mock_os.client.msearch.return_value = _msearch_response(
            [_hit("found-1", "FoundCo")],
            [],  # no hits for MissingCo
        )
        with patch.object(pipeline._search, "asearch",
                   new=AsyncMock(return_value=_tavily_response("https://u/1"))), \
             patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(return_value=_llm_completion(events_json))):
            results = asyncio.run(pipeline.run("AI funding", _intent()))

        ids = [r["_id"] for r in results]
        assert "found-1" in ids
        assert any(i.startswith("synthetic_") for i in ids)


# ---------------------------------------------------------------------------
# PII-flagged query → returns []
# ---------------------------------------------------------------------------

class TestAgenticPipelinePIIBlocking:
    def test_pii_query_returns_empty(self):
        pipeline, mock_os = _make_pipeline()
        with patch("app.services.agentic_pipeline.detect_pii",
                   return_value=["email"]):
            results = asyncio.run(pipeline.run(
                "find john@example.com funding", _intent()))
        assert results == []
        mock_os.client.msearch.assert_not_called()


# ---------------------------------------------------------------------------
# min_resolve_score gate — low-scoring hits become synthetic
# ---------------------------------------------------------------------------

class TestAgenticPipelineMinResolveScore:
    def test_low_score_hit_replaced_by_synthetic(self):
        pipeline, mock_os = _make_pipeline()
        # Force a high min score so the only hit is rejected
        pipeline._min_resolve_score = 99.0

        events_json = (
            '{"events": [{"company_name": "WeakMatch", '
            '"event_type": "funding", "summary": "x"}]}'
        )
        mock_os.client.msearch.return_value = _msearch_response(
            [_hit("low-1", "WeakMatch", score=1.0)]
        )
        with patch.object(pipeline._search, "asearch",
                   new=AsyncMock(return_value=_tavily_response("https://u/1"))), \
             patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(return_value=_llm_completion(events_json))):
            results = asyncio.run(pipeline.run("AI funding", _intent()))

        assert len(results) == 1
        assert results[0]["_id"].startswith("synthetic_")
