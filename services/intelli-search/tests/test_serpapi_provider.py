"""
Tests for the SerpAPI Google AI Mode client and the pluggable web-search
provider switch in AgenticPipeline.
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

# Reuse helpers from the main pipeline test module
from tests.test_agentic_pipeline import (
    _hit,
    _intent,
    _llm_completion,
    _make_pipeline,
    _msearch_response,
    _tavily_response,
)


# ---------------------------------------------------------------------------
# Web-search provider switch (Tavily | SerpAPI)
# ---------------------------------------------------------------------------

class TestAgenticPipelineProviderSelection:
    def test_default_provider_is_tavily(self):
        pipeline, _ = _make_pipeline()
        assert pipeline._provider_name == "tavily"
        assert pipeline._search is pipeline._tavily

    def test_serpapi_selected_when_configured(self):
        from app.services.agentic_pipeline import AgenticPipeline
        with patch(
            "app.services.agentic_pipeline.get_search_config",
            return_value={"agentic": {"web_search": {"provider": "serpapi"}}},
        ):
            pipeline = AgenticPipeline(
                opensearch_service=MagicMock(),
                openai_api_key="sk-test",
                tavily_key="tav-test",
                serpapi_key="serp-test",
            )
        assert pipeline._provider_name == "serpapi"
        assert pipeline._search is pipeline._serpapi
        # Tavily client still available for /extract calls.
        assert pipeline._tavily.enabled

    def test_serpapi_without_key_falls_back_to_tavily(self):
        from app.services.agentic_pipeline import AgenticPipeline
        with patch(
            "app.services.agentic_pipeline.get_search_config",
            return_value={"agentic": {"web_search": {"provider": "serpapi"}}},
        ):
            pipeline = AgenticPipeline(
                opensearch_service=MagicMock(),
                openai_api_key="sk-test",
                tavily_key="tav-test",
                serpapi_key=None,
            )
        assert pipeline._provider_name == "tavily"
        assert pipeline._search is pipeline._tavily

    def test_pipeline_uses_serpapi_for_web_search_when_configured(self):
        from app.services.agentic_pipeline import AgenticPipeline
        with patch(
            "app.services.agentic_pipeline.get_search_config",
            return_value={
                "agentic": {
                    "web_search": {"provider": "serpapi"},
                    "resolve_to_index": True,
                }
            },
        ):
            pipeline = AgenticPipeline(
                opensearch_service=MagicMock(),
                openai_api_key="sk-test",
                tavily_key="tav-test",
                serpapi_key="serp-test",
            )
        pipeline._resolve_to_index = True
        pipeline._min_resolve_score = 0.5
        pipeline._opensearch.client.msearch.return_value = _msearch_response(
            [_hit("c1", "SerpCo")]
        )
        events_json = (
            '{"events": [{"company_name": "SerpCo", "event_type": "funding", '
            '"summary": "Raised", "source_url": "https://u/1"}]}'
        )
        serp_mock = AsyncMock(return_value=_tavily_response("https://u/1"))
        tav_mock = AsyncMock(return_value={"results": []})
        with patch.object(pipeline._serpapi, "asearch", new=serp_mock), \
             patch.object(pipeline._tavily, "asearch", new=tav_mock), \
             patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(return_value=_llm_completion(events_json))):
            results = asyncio.run(pipeline.run("AI funding", _intent()))
        assert len(results) == 1
        assert results[0]["name"] == "SerpCo"
        assert serp_mock.await_count >= 1
        assert tav_mock.await_count == 0


# ---------------------------------------------------------------------------
# SerpApiClient — unit tests (reference translation + safety paths)
# ---------------------------------------------------------------------------

class TestSerpApiClient:
    def test_references_translated_to_tavily_shape(self):
        from app.services.serpapi_client import _references_to_tavily_results
        payload = {
            "references": [
                {"title": "First", "link": "https://a", "snippet": "alpha"},
                {"title": "Second", "link": "https://b", "snippet": "beta"},
            ]
        }
        results = _references_to_tavily_results(payload)
        assert [r["url"] for r in results] == ["https://a", "https://b"]
        assert results[0]["title"] == "First"
        assert results[0]["content"] == "alpha"
        # Reference scores are capped just under the AI-summary slot (1.0).
        assert results[0]["score"] == 0.99
        assert results[1]["score"] < results[0]["score"]
        assert results[0]["published_date"] is None

    def test_references_skips_entries_without_link(self):
        from app.services.serpapi_client import _references_to_tavily_results
        payload = {"references": [{"title": "no link"}, {"link": "https://ok"}]}
        out = _references_to_tavily_results(payload)
        assert len(out) == 1
        assert out[0]["url"] == "https://ok"

    def test_disabled_when_no_api_key(self):
        from app.services.serpapi_client import SerpApiClient
        client = SerpApiClient(api_key=None)
        assert client.enabled is False
        assert asyncio.run(client.asearch("anything")) == {}

    def test_asearch_returns_tavily_shape(self):
        from app.services.serpapi_client import SerpApiClient
        client = SerpApiClient(api_key="serp-test", max_results=5)
        fake_payload = {
            "references": [
                {"title": "A", "link": "https://a", "snippet": "sa"},
                {"title": "B", "link": "https://b", "snippet": "sb"},
            ]
        }
        with patch("app.services.serpapi_client._get_sync",
                   return_value=fake_payload):
            data = asyncio.run(client.asearch("startups funding"))
        assert "results" in data
        assert [r["url"] for r in data["results"]] == ["https://a", "https://b"]

    def test_asearch_returns_empty_on_api_error(self):
        from app.services.serpapi_client import SerpApiClient
        client = SerpApiClient(api_key="serp-test")
        with patch("app.services.serpapi_client._get_sync",
                   return_value={"error": "Your account has run out of searches."}):
            data = asyncio.run(client.asearch("q"))
        assert data == {}

    def test_max_results_cap_applied(self):
        from app.services.serpapi_client import SerpApiClient
        client = SerpApiClient(api_key="serp-test", max_results=2)
        fake_payload = {
            "references": [
                {"title": f"T{i}", "link": f"https://x/{i}", "snippet": "s"}
                for i in range(5)
            ]
        }
        with patch("app.services.serpapi_client._get_sync",
                   return_value=fake_payload):
            data = asyncio.run(client.asearch("q"))
        assert len(data["results"]) == 2

    def test_ai_mode_summary_is_pinned_first(self):
        from app.services.serpapi_client import _serpapi_to_tavily_results
        payload = {
            "reconstructed_markdown": (
                "## Recently Funded\n"
                "- Neara: $90M Series D Feb 2026\n"
                "- Airwallex: $498M Series G late 2025"
            ),
            "search_metadata": {"google_ai_mode_url": "https://google/ai"},
            "references": [
                {"title": "Cite A", "link": "https://a", "snippet": "frag"},
                {"title": "Cite B", "link": "https://b", "snippet": "frag"},
            ],
        }
        out = _serpapi_to_tavily_results(payload)
        assert out[0]["title"] == "Google AI Mode summary"
        assert out[0]["score"] == 1.0
        assert "Neara" in out[0]["content"]
        assert "Airwallex" in out[0]["content"]
        assert out[0]["url"] == "https://google/ai"
        # References follow with score < summary
        assert all(r["score"] < 1.0 for r in out[1:])
        assert [r["url"] for r in out[1:]] == ["https://a", "https://b"]

    def test_text_blocks_used_when_markdown_absent(self):
        from app.services.serpapi_client import _serpapi_to_tavily_results
        payload = {
            "text_blocks": [
                {"type": "heading", "snippet": "Funded Co's"},
                {"type": "list", "list": [
                    {"snippet": "Neara: $90M Series D"},
                    {"snippet": "Gilmour Space: $145M Series E"},
                ]},
            ],
            "references": [],
        }
        out = _serpapi_to_tavily_results(payload)
        assert len(out) == 1
        assert out[0]["title"] == "Google AI Mode summary"
        assert "Neara" in out[0]["content"]
        assert "Gilmour Space" in out[0]["content"]

    def test_no_summary_when_body_empty(self):
        from app.services.serpapi_client import _serpapi_to_tavily_results
        out = _serpapi_to_tavily_results({
            "references": [{"title": "Only ref", "link": "https://r", "snippet": "x"}]
        })
        assert len(out) == 1
        assert out[0]["title"] == "Only ref"


# ---------------------------------------------------------------------------
# Pipeline behaviour: skip secondary query + split-prompt extraction
# ---------------------------------------------------------------------------

class TestSerpApiPipelineExtraction:
    def _serpapi_pipeline(self):
        from app.services.agentic_pipeline import AgenticPipeline
        with patch(
            "app.services.agentic_pipeline.get_search_config",
            return_value={
                "agentic": {
                    "web_search": {"provider": "serpapi"},
                    "summary_chars": 6000,
                    "citation_chars": 400,
                    "content_chars": 800,
                }
            },
        ):
            pipeline = AgenticPipeline(
                opensearch_service=MagicMock(),
                openai_api_key="sk-test",
                tavily_key="tav-test",
                serpapi_key="serp-test",
            )
        return pipeline

    def test_serpapi_skips_secondary_query(self):
        pipeline = self._serpapi_pipeline()
        # Even when intent.search_query differs from the raw user query,
        # SerpAPI path must not build a secondary query.
        assert pipeline._build_secondary_query(
            "raw user words", "optimised query"
        ) is None

    def test_tavily_still_uses_secondary_query(self):
        pipeline, _ = _make_pipeline()
        assert pipeline._provider_name == "tavily"
        assert pipeline._build_secondary_query(
            "raw user words", "optimised query"
        ) == "raw user words"

    def test_extraction_prompt_splits_summary_from_citations(self):
        from app.services.agentic_pipeline import TavilyResult
        pipeline = self._serpapi_pipeline()
        hits = [
            TavilyResult(
                title="Google AI Mode summary",
                url="https://google/ai",
                content="Neara: $90M Series D. Airwallex: $498M Series G.",
                published_date=None,
            ),
            TavilyResult(
                title="Cite A",
                url="https://a",
                content="frag a",
                published_date="2026-04-01",
            ),
        ]
        captured = {}

        async def _fake_create(**kwargs):
            captured["user"] = kwargs["messages"][1]["content"]
            return _llm_completion('{"events": []}')

        with patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(side_effect=_fake_create)):
            asyncio.run(pipeline._extract_events("q", "q", hits))

        msg = captured["user"]
        assert "=== Primary AI answer" in msg
        assert "=== Supporting citations ===" in msg
        assert "Neara" in msg
        assert "Airwallex" in msg
        assert "Cite A" in msg

    def test_extraction_prompt_uniform_when_no_summary(self):
        from app.services.agentic_pipeline import TavilyResult
        pipeline, _ = _make_pipeline()  # tavily path
        hits = [
            TavilyResult(title="A", url="https://a", content="x", published_date=None),
            TavilyResult(title="B", url="https://b", content="y", published_date=None),
        ]
        captured = {}

        async def _fake_create(**kwargs):
            captured["user"] = kwargs["messages"][1]["content"]
            return _llm_completion('{"events": []}')

        with patch.object(pipeline._openai.chat.completions, "create",
                          new=AsyncMock(side_effect=_fake_create)):
            asyncio.run(pipeline._extract_events("q", "q", hits))

        msg = captured["user"]
        assert "=== Primary AI answer" not in msg
        assert "=== Supporting citations ===" not in msg
