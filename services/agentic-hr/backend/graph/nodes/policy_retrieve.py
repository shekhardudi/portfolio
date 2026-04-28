"""
policy_retrieve node — hybrid retrieval using vector search + FTS,
fused with reciprocal rank fusion.

Optimised: batch-embeds all query variants in one call, then runs
all vector + FTS searches in parallel threads (I/O-bound, GIL-safe).
"""
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from logger import get_logger
from models.state import AgentState
from db.rag import vector_search, fulltext_search, reciprocal_rank_fusion
from db.embedder import embed_texts

log = get_logger(__name__)


def policy_retrieve_node(state: AgentState) -> AgentState:
    """Retrieve relevant policy chunks using hybrid vector + full-text search.

    Batch-embeds all query variants in a single model.encode() call, then
    fires all vector searches and FTS searches in parallel via a thread pool.
    Deduplicates results keeping the highest score per child_id, then fuses
    the two ranked lists with Reciprocal Rank Fusion to produce the top 8
    chunks.

    Args:
        state: AgentState with rewritten_queries (or falls back to message).

    Returns:
        Updated AgentState with retrieved_chunks list (up to 8 fused results).
    """
    queries = state.get("rewritten_queries") or [state["message"]]
    log.info("Hybrid retrieval | %d query variant(s)", len(queries))
    t0 = time.perf_counter()

    # --- Batch-embed all queries in one model.encode() call ---
    embeddings = embed_texts(queries)

    # --- Fire all vector + FTS searches in parallel ---
    all_vector: list[dict] = []
    all_fts: list[dict] = []

    def _vec_search(emb: list[float]) -> list[dict]:
        return vector_search(emb, limit=10)

    def _fts_search(q: str) -> list[dict]:
        return fulltext_search(q, limit=10)

    with ThreadPoolExecutor(max_workers=len(queries) * 2) as pool:
        vec_futures = {
            pool.submit(_vec_search, emb): i
            for i, emb in enumerate(embeddings)
        }
        fts_futures = {
            pool.submit(_fts_search, q): i
            for i, q in enumerate(queries)
        }

        for fut in as_completed(vec_futures):
            all_vector.extend(fut.result())
        for fut in as_completed(fts_futures):
            all_fts.extend(fut.result())

    log.debug("Raw results before dedup | vector=%d | fts=%d", len(all_vector), len(all_fts))

    seen_vec: dict[str, dict] = {}
    for r in all_vector:
        cid = r["child_id"]
        if cid not in seen_vec or r["score"] > seen_vec[cid]["score"]:
            seen_vec[cid] = r

    seen_fts: dict[str, dict] = {}
    for r in all_fts:
        cid = r["child_id"]
        if cid not in seen_fts or r["score"] > seen_fts[cid]["score"]:
            seen_fts[cid] = r

    fused = reciprocal_rank_fusion(
        list(seen_vec.values()),
        list(seen_fts.values()),
        top_n=8,
    )
    elapsed = time.perf_counter() - t0
    log.info(
        "Retrieval complete | unique_vector=%d | unique_fts=%d | fused=%d | elapsed=%.2fs",
        len(seen_vec), len(seen_fts), len(fused), elapsed,
    )
    state["retrieved_chunks"] = fused
    return state
