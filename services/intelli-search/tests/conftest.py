"""
Shared pytest fixtures for the backend test suite.

Provides:
- settings_override   — patched Settings with safe test defaults
- mock_opensearch     — MagicMock for the OpenSearch client
- mock_openai         — MagicMock for the OpenAI / Instructor client
- test_client         — HTTPX TestClient for the FastAPI app
"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def settings_override(monkeypatch):
    """Override all required env vars so Settings() never raises."""
    env = {
        "OPENAI_API_KEY": "sk-test-key",
        "OPENSEARCH_HOST": "localhost",
        "OPENSEARCH_PORT": "9200",
        "OPENSEARCH_USER": "admin",
        "OPENSEARCH_PASSWORD": "test-password",
        "OPENSEARCH_INDEX_NAME": "companies-new",
        "OPENSEARCH_VERIFY_CERTS": "false",
        "ENVIRONMENT": "test",
        "OTLP_ENDPOINT": "http://localhost:4317",
        "OTEL_SERVICE_NAME": "intelli-search-test",
        "SEARCH_CONFIG_PATH": "search_config.yaml",
    }
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    # Clear the lru_cache so fresh Settings() is built
    from app import config as cfg
    cfg.get_settings.cache_clear()
    cfg.get_search_config.cache_clear()
    yield
    cfg.get_settings.cache_clear()
    cfg.get_search_config.cache_clear()


# ---------------------------------------------------------------------------
# OpenSearch mock
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_opensearch():
    with patch("app.services.opensearch_service.OpenSearch") as mock_cls:
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        # Default healthy response
        mock_client.info.return_value = {"version": {"number": "2.x"}}
        # Default search response
        mock_client.search.return_value = {
            "hits": {
                "total": {"value": 1},
                "hits": [
                    {
                        "_id": "c1",
                        "_score": 0.9,
                        "_source": {
                            "id": "c1",
                            "name": "Acme Corp",
                            "domain": "acme.com",
                            "industry": "technology",
                            "country": "US",
                            "locality": "San Francisco",
                            "searchable_text": "Acme Corp technology company",
                            "year_founded": 2010,
                            "size_range": "51-200",
                            "current_employee_estimate": 100,
                            "linkedin_url": "https://linkedin.com/company/acme-corp",
                        },
                    }
                ],
            }
        }
        yield mock_client


# ---------------------------------------------------------------------------
# OpenAI / Instructor mock
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_openai():
    with patch("app.services.intent_classifier.instructor") as mock_instructor, \
         patch("app.services.intent_classifier.OpenAI") as mock_openai_cls:
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_instructor.from_openai.return_value = mock_client
        yield mock_client


# ---------------------------------------------------------------------------
# FastAPI TestClient
# ---------------------------------------------------------------------------

@pytest.fixture
def test_client(mock_opensearch):
    """Return a synchronous HTTPX test client for the FastAPI app."""
    # Patch OTel setup to be no-ops during tests
    with patch("app.observability.tracing.configure_tracing"), \
         patch("app.observability.metrics.configure_metrics"), \
         patch("app.observability.logging.configure_log_export"), \
         patch("app.observability.tracing.instrument_fastapi"), \
         patch("app.main.instrument_fastapi"):
        from app.main import get_application
        app = get_application()
        with TestClient(app, raise_server_exceptions=True) as client:
            yield client
