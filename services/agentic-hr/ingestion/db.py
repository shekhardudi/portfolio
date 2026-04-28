"""
db.py — PostgreSQL helpers for the ingestion pipeline.
"""
import psycopg2

from config import POSTGRES_DSN
from logger import get_logger

log = get_logger(__name__)


def get_conn():
    log.debug("Opening PostgreSQL connection for ingestion")
    return psycopg2.connect(POSTGRES_DSN)


def store_document(
    conn,
    doc_id: str,
    filename: str,
    markdown: str,
    parent_sections: list[dict],
    child_windows_with_embeddings: list[list[dict]],
) -> None:
    log.info("Storing document | id=%s | filename=%s | sections=%d", doc_id, filename, len(parent_sections))
    total_children = sum(len(c) for c in child_windows_with_embeddings)
    log.debug("Total child chunks to insert: %d", total_children)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO documents (document_id, filename, raw_markdown)
            VALUES (%s, %s, %s)
            ON CONFLICT (document_id) DO UPDATE
                SET filename = EXCLUDED.filename,
                    raw_markdown = EXCLUDED.raw_markdown,
                    ingested_at = now()
            """,
            (doc_id, filename, markdown),
        )

        for i, section in enumerate(parent_sections):
            parent_id = f"{doc_id}_p{i}"

            cur.execute(
                """
                INSERT INTO parent_chunks
                    (parent_id, document_id, heading, content, summary, chunk_index)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (parent_id) DO UPDATE
                    SET heading = EXCLUDED.heading,
                        content = EXCLUDED.content,
                        summary = EXCLUDED.summary
                """,
                (
                    parent_id,
                    doc_id,
                    section["heading"],
                    section["content"],
                    section.get("summary", ""),
                    i,
                ),
            )

            children = child_windows_with_embeddings[i] if i < len(child_windows_with_embeddings) else []
            for j, child in enumerate(children):
                child_id = f"{parent_id}_c{j}"
                embedding_str = "[" + ",".join(str(x) for x in child["embedding"]) + "]"
                cur.execute(
                    """
                    INSERT INTO child_chunks
                        (child_id, parent_id, content, window_index, embedding)
                    VALUES (%s, %s, %s, %s, %s::vector)
                    ON CONFLICT (child_id) DO UPDATE
                        SET content = EXCLUDED.content,
                            embedding = EXCLUDED.embedding
                    """,
                    (child_id, parent_id, child["text"], j, embedding_str),
                )

    conn.commit()
    log.info("Document stored | id=%s | parent_chunks=%d | child_chunks=%d", doc_id, len(parent_sections), total_children)


def build_hnsw_index(conn) -> None:
    """Create HNSW cosine index on child_chunks.embedding."""
    log.info("Building HNSW index on child_chunks.embedding")
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_child_chunks_embedding
            ON child_chunks
            USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 200)
            """
        )
    conn.commit()
    log.info("HNSW index ready")
