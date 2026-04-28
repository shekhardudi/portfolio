"""
RAG query functions — vector search + full-text search on child_chunks.
All calls go directly to PostgreSQL (psycopg2), not through MCP.
"""
from logger import get_logger
from db.connection import ManagedConn

log = get_logger(__name__)


def vector_search(query_embedding: list[float], limit: int = 10) -> list[dict]:
    """Cosine similarity search on child_chunks using pgvector."""
    log.debug("Vector search | limit=%d | embedding_dim=%d", limit, len(query_embedding))
    sql = """
        SELECT
            c.child_id,
            c.parent_id,
            c.content,
            c.window_index,
            1 - (c.embedding <=> %s::vector) AS score
        FROM child_chunks c
        ORDER BY c.embedding <=> %s::vector
        LIMIT %s
    """
    embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (embedding_str, embedding_str, limit))
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            results = [dict(zip(cols, row)) for row in rows]
    log.debug("Vector search returned %d results", len(results))
    return results


def fulltext_search(query: str, limit: int = 10) -> list[dict]:
    """Full-text search on child_chunks using tsvector/tsquery."""
    log.debug("FTS search | query=%r | limit=%d", query[:60], limit)
    sql = """
        SELECT
            c.child_id,
            c.parent_id,
            c.content,
            c.window_index,
            ts_rank(c.ts_content, plainto_tsquery('english', %s)) AS score
        FROM child_chunks c
        WHERE c.ts_content @@ plainto_tsquery('english', %s)
        ORDER BY score DESC
        LIMIT %s
    """
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (query, query, limit))
            rows = cur.fetchall()
            cols = [d[0] for d in cur.description]
            results = [dict(zip(cols, row)) for row in rows]
    log.debug("FTS search returned %d results", len(results))
    return results


def get_parent_section(parent_id: str) -> dict | None:
    """Fetch a parent chunk with its document filename for context expansion."""
    log.debug("Fetching parent section | parent_id=%s", parent_id)
    sql = """
        SELECT
            p.parent_id,
            p.document_id,
            p.heading,
            p.content,
            p.summary,
            p.chunk_index,
            d.filename
        FROM parent_chunks p
        JOIN documents d ON d.document_id = p.document_id
        WHERE p.parent_id = %s
    """
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (parent_id,))
            row = cur.fetchone()
            if row is None:
                log.warning("Parent section not found | parent_id=%s", parent_id)
                return None
            cols = [d[0] for d in cur.description]
            return dict(zip(cols, row))


def reciprocal_rank_fusion(
    vector_results: list[dict],
    fts_results: list[dict],
    k: int = 60,
    top_n: int = 5,
) -> list[dict]:
    """
    Fuse vector and FTS result lists using Reciprocal Rank Fusion.
    Returns top_n deduplicated child chunks ordered by fused score.
    """
    log.debug(
        "RRF fusion | vector=%d | fts=%d | k=%d | top_n=%d",
        len(vector_results), len(fts_results), k, top_n,
    )
    scores: dict[str, float] = {}
    chunks: dict[str, dict] = {}

    for rank, item in enumerate(vector_results):
        cid = item["child_id"]
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        chunks[cid] = item

    for rank, item in enumerate(fts_results):
        cid = item["child_id"]
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
        if cid not in chunks:
            chunks[cid] = item

    ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    fused = [chunks[cid] for cid, _ in ranked[:top_n]]
    log.debug("RRF produced %d fused results", len(fused))
    return fused
