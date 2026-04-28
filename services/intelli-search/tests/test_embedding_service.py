"""Tests for EmbeddingService — caching and BoundedDict eviction."""
import pytest
from unittest.mock import MagicMock, patch
import numpy as np


@pytest.fixture
def embedding_service():
    with patch("app.services.embedding_service.SentenceTransformer") as mock_st:
        mock_model = MagicMock()
        mock_model.encode.return_value = np.ones(384, dtype=np.float32)
        mock_st.return_value = mock_model
        from app.services.embedding_service import EmbeddingService
        svc = EmbeddingService(model_path="/fake/model")
        # Force model to load immediately
        svc._model = mock_model
        yield svc


def test_embed_returns_list_of_floats(embedding_service):
    result = embedding_service.embed("hello world")
    assert isinstance(result, list)
    assert len(result) == 384
    assert all(isinstance(v, float) for v in result)


def test_embed_caches_result(embedding_service):
    embedding_service.embed("cached query")
    embedding_service.embed("cached query")
    # Model encode should only be called once
    assert embedding_service._model.encode.call_count == 1


def test_embed_bge_prefix_applied(embedding_service):
    embedding_service.embed("test query")
    call_args = embedding_service._model.encode.call_args[0][0]
    assert "Represent this sentence" in call_args


def test_embed_document_no_prefix(embedding_service):
    embedding_service.embed_document("Acme Corp is a technology company.")
    call_args = embedding_service._model.encode.call_args[0][0]
    assert "Represent this sentence" not in call_args


def test_cache_bounded_eviction(embedding_service):
    embedding_service._model.encode.return_value = np.ones(384, dtype=np.float32)
    maxsize = embedding_service._cache_maxsize

    for i in range(maxsize + 5):
        embedding_service.embed(f"unique query number {i}")

    assert len(embedding_service._embed_cache) <= maxsize


def test_embed_dimension(embedding_service):
    assert embedding_service.get_embedding_dimension() == 384


def test_embed_empty_returns_zero_vector(embedding_service):
    result = embedding_service.embed("")
    assert isinstance(result, list)
    assert len(result) == 384
    assert all(v == 0.0 for v in result)
    # Model should not be called for empty input
    embedding_service._model.encode.assert_not_called()


def test_embed_document_caches_with_different_key(embedding_service):
    """embed() and embed_document() on the same text use different cache keys."""
    embedding_service.embed("Acme Corp")
    embedding_service.embed_document("Acme Corp")
    # Model should be called twice — once for each cache key (q: vs d:)
    assert embedding_service._model.encode.call_count == 2
