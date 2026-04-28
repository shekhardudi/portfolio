"""
embedder.py — runtime embedding for RAG retrieval queries.
Mirrors ingestion/embedder.py but lives inside the backend package
so the backend has no import dependency on the ingestion package.
"""
import os
import time
from functools import lru_cache

from logger import get_logger

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
log = get_logger(__name__)


@lru_cache(maxsize=1)
def _get_model():
    """Load and cache the sentence-transformers embedding model.

    The model is loaded on first call and held in memory for the lifetime of
    the process. Subsequent calls return the cached instance.

    Returns:
        A SentenceTransformer model ready for encoding.
    """
    log.info("Loading embedding model: %s", EMBEDDING_MODEL)
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(EMBEDDING_MODEL)
    log.info("Embedding model loaded")
    return model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts. Returns list of float vectors."""
    if not texts:
        return []
    log.debug("Embedding %d text(s)", len(texts))
    t0 = time.perf_counter()
    model = _get_model()
    embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    elapsed = time.perf_counter() - t0
    log.debug("Embedding done | count=%d | elapsed=%.2fs", len(texts), elapsed)
    return [emb.tolist() for emb in embeddings]
