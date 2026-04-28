"""
embedder.py — generates vector embeddings for text chunks.
Uses sentence-transformers (local, no API key).
"""
import time
from functools import lru_cache

from config import EMBEDDING_MODEL
from logger import get_logger

log = get_logger(__name__)


@lru_cache(maxsize=1)
def _get_model():
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
