"""Tests for app.config — Settings loading and get_search_config()."""
import os
import pytest
from pathlib import Path


def test_settings_fields(settings_override):
    from app.config import get_settings
    s = get_settings()
    assert s.OPENSEARCH_INDEX_NAME == "companies-new"
    assert s.OTEL_SERVICE_NAME == "intelli-search-test"
    assert s.OTLP_ENDPOINT == "http://localhost:4317"


def test_settings_respect_env_override(monkeypatch):
    from app import config as cfg
    cfg.get_settings.cache_clear()
    monkeypatch.setenv("OPENSEARCH_INDEX_NAME", "custom-index")
    s = cfg.get_settings()
    assert s.OPENSEARCH_INDEX_NAME == "custom-index"
    cfg.get_settings.cache_clear()


def test_get_search_config_returns_expected_keys(settings_override):
    from app.config import get_search_config
    cfg = get_search_config()
    assert "rrf" in cfg
    assert "field_boosts" in cfg
    assert "cache" in cfg


def test_get_search_config_rrf_k_positive(settings_override):
    from app.config import get_search_config
    rrf = get_search_config()["rrf"]
    assert rrf["k"] > 0
    assert rrf["knn_k"] > 0
    assert rrf["fetch_multiplier"] >= 1


def test_get_search_config_cache_sizes_positive(settings_override):
    from app.config import get_search_config
    cache = get_search_config()["cache"]
    assert cache["embedding_maxsize"] > 0
    assert cache["classifier_maxsize"] > 0


def test_get_search_config_missing_file(monkeypatch, tmp_path):
    """Missing config file should raise FileNotFoundError on first call."""
    import app.config as cfg
    cfg.get_settings.cache_clear()
    cfg.get_search_config.cache_clear()
    monkeypatch.setenv("SEARCH_CONFIG_PATH", str(tmp_path / "missing.yaml"))
    with pytest.raises(FileNotFoundError):
        cfg.get_search_config()
    cfg.get_settings.cache_clear()
    cfg.get_search_config.cache_clear()


def test_get_search_config_has_semantic_mode(settings_override):
    from app.config import get_search_config
    cfg = get_search_config()
    assert "semantic" in cfg
    assert "mode" in cfg["semantic"]
    assert cfg["semantic"]["mode"] in ("knn", "rrf")


def test_get_search_config_has_popularity_boost(settings_override):
    from app.config import get_search_config
    cfg = get_search_config()
    boosts = cfg.get("field_boosts", {}).get("bm25_regular", {})
    assert "popularity_boost_factor" in boosts
    assert float(boosts["popularity_boost_factor"]) >= 0
