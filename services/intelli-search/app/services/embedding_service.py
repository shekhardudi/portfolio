"""
Embedding Service - Generates vector embeddings using a sentence-transformers model.
All model configuration (name, dimension, query prefix) is driven
from search_config.yaml under the `embedding:` key — no hardcoded values here.

BGE asymmetric retrieval:
  - Queries:    encoded with `query_prefix` prepended
  - Documents:  encoded as plain text (no prefix)
For symmetric models (e.g. all-MiniLM), set query_prefix to "".
"""
import structlog
from functools import lru_cache
from typing import List, Optional
import numpy as np
from sentence_transformers import SentenceTransformer
from app.config import get_search_config
from app.utils.cache import BoundedDict

logger = structlog.get_logger(__name__)


def _get_embedding_config() -> dict:
    """Return the embedding sub-section of search_config.yaml."""
    return get_search_config().get("embedding", {})


class EmbeddingService:
    """
    Generates embeddings using sentence-transformers.
    Model, dimension, query prefix, and batch sizes are all read from
    search_config.yaml so they can be changed without touching this file.
    """

    def __init__(self, model_path: Optional[str] = None):
        """
        Initialise the embedding service.

        Args:
            model_path: Override the model name / path from config.
                        Useful in tests or when passing an explicit local path.
        """
        cfg = _get_embedding_config()

        self._query_prefix: str = cfg.get("query_prefix", "")
        # Configured dimension is used as the fallback for zero-vectors before
        # the model is loaded; overridden by the actual model once loaded.
        self._configured_dim: int = int(cfg.get("dimension", 768))

        self.model_path: str = model_path or cfg.get("model", "BAAI/bge-base-en-v1.5")
        self._model: Optional[SentenceTransformer] = None  # lazy-loaded

        _maxsize = get_search_config().get("cache", {}).get("embedding_maxsize", 512)
        self._embed_cache: BoundedDict = BoundedDict(maxsize=_maxsize)
        self._cache_maxsize: int = _maxsize

        logger.info(
            "embedding_service_initialized",
            model_path=self.model_path,
            configured_dim=self._configured_dim,
            query_prefix=repr(self._query_prefix),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def model(self) -> SentenceTransformer:
        """Lazy-load the sentence-transformer model on first access."""
        if self._model is None:
            logger.info("loading_sentence_transformer", model_path=self.model_path)
            try:
                self._model = SentenceTransformer(self.model_path)
                logger.info("sentence_transformer_model_loaded")
            except Exception as e:
                logger.error("model_loading_failed", error=str(e))
                raise
        return self._model

    @property
    def embedding_dim(self) -> int:
        """Actual output dimension — introspected from the loaded model when available."""
        if self._model is not None:
            try:
                dim = self._model.get_sentence_embedding_dimension()
                if isinstance(dim, int):
                    return dim
            except Exception:
                pass
        return self._configured_dim

    def get_embedding_dimension(self) -> int:
        """Public accessor for the embedding vector dimension."""
        return self.embedding_dim

    def _zero_vector(self) -> List[float]:
        return [0.0] * self.embedding_dim

    # ------------------------------------------------------------------
    # Single-text encode
    # ------------------------------------------------------------------

    def embed(self, text: str) -> List[float]:
        """
        Encode a query string with the configured query prefix.
        Use at search time — NOT when indexing documents.
        """
        if not text or not text.strip():
            logger.warning("empty_text_embedding_requested")
            return self._zero_vector()

        cache_key = f"q:{text.strip()}"
        if cache_key in self._embed_cache:
            return self._embed_cache[cache_key]

        try:
            prefixed = self._query_prefix + text.strip()
            raw = self.model.encode(prefixed, convert_to_tensor=False, normalize_embeddings=True)
            result: List[float] = raw.tolist() if isinstance(raw, np.ndarray) else list(raw)
            self._embed_cache[cache_key] = result
            return result
        except Exception as e:
            logger.error("embedding_generation_failed", error=str(e), text=text[:100])
            raise

    def embed_document(self, text: str) -> List[float]:
        """
        Encode a document string WITHOUT the query prefix.
        Use when indexing company documents — NOT at search time.
        """
        if not text or not text.strip():
            logger.warning("empty_text_embedding_requested")
            return self._zero_vector()

        cache_key = f"d:{text.strip()}"
        if cache_key in self._embed_cache:
            return self._embed_cache[cache_key]

        try:
            raw = self.model.encode(text.strip(), convert_to_tensor=False, normalize_embeddings=True)
            result: List[float] = raw.tolist() if isinstance(raw, np.ndarray) else list(raw)
            self._embed_cache[cache_key] = result
            return result
        except Exception as e:
            logger.error("document_embedding_generation_failed", error=str(e), text=text[:100])
            raise




# ============================================================================
# Singleton Pattern - Lazy Initialization
# ============================================================================

@lru_cache(maxsize=1)
def get_embedding_service() -> EmbeddingService:
    """
    Get or create embedding service instance (singleton).
    Used as a dependency in FastAPI endpoints.
    """
    return EmbeddingService()
