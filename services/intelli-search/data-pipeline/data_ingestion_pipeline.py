"""
data_ingestion_pipeline.py
~~~~~~~~~~~~~~~~~~~~~~~~~~
Modular, stage-based ingestion pipeline for the Intelli-Search company dataset.

Each pipeline stage is an independent, testable function with a single
responsibility. The orchestrator (run_pipeline) chains them in order.

Pipeline stages
---------------
1. read_chunks        – Stream the CSV in memory-safe chunks; never loads the
                        full file into RAM.
2. clean_chunk        – Normalise field types, fill nulls, strip whitespace.
3. enrich_records     – Derive city/state, industry tags, country tags once
                        per row, so downstream stages never recompute them.
4. build_texts        – Compose the embedding input string for each record.
5. create_embeddings  – Batch-encode texts with SentenceTransformer. Blocks
                        until ALL embeddings for the chunk are ready — no doc
                        is sent to OpenSearch before its embedding exists.
6. build_actions      – Assemble OpenSearch bulk action dicts from the
                        enriched records + embeddings.
7. bulk_insert_chunk  – Send the fully built chunk to OpenSearch via
                        helpers.bulk, split into safe HTTP request sizes.

Post-ingestion
--------------
finalize_index        – Restore refresh interval / replicas, force-refresh,
                        and force-merge HNSW segments for optimal knn recall.

Orchestration
-------------
run_pipeline(csv_path, client, model) chains stages 1-7, then finalizes.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Generator

import pandas as pd
import torch
import yaml
from dotenv import load_dotenv
from opensearchpy import OpenSearch, helpers
from sentence_transformers import SentenceTransformer

from observability import configure_logging, generate_trace_id

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
configure_logging()
import structlog
logger = structlog.get_logger(__name__)

# Base directory — all relative paths resolve from here
_BASE = Path(__file__).parent

# Try the local data-pipeline/.env first (standalone run), then the
# project-root .env (full-project run). override=False ensures that a value
# already set by the local file is not silently overwritten.
load_dotenv(_BASE / ".env")
load_dotenv(_BASE.parent / ".env", override=False)

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------
# All tunable values are loaded from ingest_config.yaml and surfaced here as a
# typed dataclass. Edit the YAML to change behaviour without touching code.

with (_BASE / "ingest_config.yaml").open() as _f:
    _yaml_cfg: dict = yaml.safe_load(_f)


@dataclass
class PipelineConfig:
    """
    Central configuration for the ingestion pipeline.
    All values default to what is declared in ingest_config.yaml.
    Pass an overridden instance to run_pipeline() for one-off adjustments.
    """

    # ---------- Index ----------
    index_name: str = _yaml_cfg["index_name"]

    # ---------- I/O ----------
    # Rows read from the CSV per iteration. Controls peak RAM usage.
    # At ~200 bytes/row, 10 000 rows ≈ 2 MB — safe even on constrained machines.
    chunk_size: int = _yaml_cfg.get("chunk_size", 10_000)

    # Docs per OpenSearch HTTP bulk request.
    # Each doc carries a 384-float vector (~1.5 KB), so 500 docs ≈ 750 KB/request.
    bulk_chunk_size: int = _yaml_cfg.get("bulk_chunk_size", 500)

    # ---------- Embedding ----------
    model_path: str = _yaml_cfg["embedding"]["model"]

    # Mini-batch size fed to the model encoder internally.
    # The encode() call still blocks until the full chunk is done.
    encode_batch_size: int = _yaml_cfg.get("embedding_batch_size", 64)

    # Vector dimension must match the loaded model and the index mapping.
    embedding_dim: int = _yaml_cfg["embedding"].get("dimension", 384)

    # ---------- Parallelism ----------
    # When True, Stage 5 (embed) for the NEXT chunk runs concurrently with
    # Stage 7 (bulk insert) for the CURRENT chunk using a thread-pool.
    parallel_embed_insert: bool = _yaml_cfg.get("parallel_embed_insert", True)


# Module-level singleton — used unless the caller supplies an override.
CONFIG = PipelineConfig()

# ---------------------------------------------------------------------------
# TAXONOMIES  (loaded once at module import — zero per-row I/O)
# ---------------------------------------------------------------------------

with (_BASE / "industry_taxonomy.json").open() as _f:
    _INDUSTRY_TAXONOMY: dict[str, list[str]] = json.load(_f)

with (_BASE / "country_taxonomy.json").open() as _f:
    _COUNTRY_TAXONOMY: dict[str, list[str]] = json.load(_f)

# ---------------------------------------------------------------------------
# Shared type alias for the enriched-per-row tuple produced by enrich_records.
# (industry, locality, city, state, industry_tags, size_range, country_tags)
# ---------------------------------------------------------------------------
EnrichedRow = tuple[str, str, str, str, list[str], str, list[str]]


# ===========================================================================
# STAGE 1 — READ CHUNKS
# ===========================================================================

def read_chunks(
    file_path: str,
    chunk_size: int = CONFIG.chunk_size,
) -> Generator[pd.DataFrame, None, None]:
    """
    Stage 1 | Read
    ~~~~~~~~~~~~~~
    Stream the CSV from disk one chunk at a time using pandas' chunksize
    parameter, so the full 7M-row file is never held in memory.

    Parameters
    ----------
    file_path  : path to the CSV file.
    chunk_size : rows per yielded DataFrame. Tune this to balance RAM vs.
                 the number of encode() calls (larger = fewer calls, more RAM).

    Yields
    ------
    pd.DataFrame — raw, uncleaned chunk straight from the CSV.

    Raises
    ------
    FileNotFoundError if the CSV does not exist.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {file_path}")

    _COLUMN_RENAME = {
        "year founded": "year_founded",
        "size range": "size_range",
        "linkedin url": "linkedin_url",
        "current employee estimate": "current_employee_estimate",
        "total employee estimate": "total_employee_estimate",
    }

    logger.info("stage1_read_started", path=file_path, chunk_size=chunk_size)
    for chunk in pd.read_csv(path, chunksize=chunk_size):
        chunk.rename(columns=_COLUMN_RENAME, inplace=True)
        yield chunk


# ===========================================================================
# STAGE 2 — CLEAN CHUNK
# ===========================================================================

def clean_chunk(chunk: pd.DataFrame) -> pd.DataFrame:
    """
    Stage 2 | Clean
    ~~~~~~~~~~~~~~~
    Normalise a raw DataFrame chunk in-place:
      - Cast year_founded to int (coerce non-numeric → 0).
      - Fill NaN and strip whitespace for all string columns.
      - Replace blank strings in required fields with a readable sentinel.

    Parameters
    ----------
    chunk : raw DataFrame as yielded by read_chunks.

    Returns
    -------
    The same DataFrame, mutated and cleaned.
    """
    # Numeric columns — guard against missing columns (e.g. all-NaN chunks)
    for col in ("year_founded", "current_employee_estimate", "total_employee_estimate"):
        if col in chunk.columns:
            chunk[col] = pd.to_numeric(chunk[col], errors="coerce").fillna(0).astype(int)
        else:
            chunk[col] = 0

    # String columns — fill NaN, cast to str, strip leading/trailing whitespace
    for col in ("industry", "country", "locality", "name", "domain", "size_range"):
        if col in chunk.columns:
            chunk[col] = chunk[col].fillna("").astype(str).str.strip()

    # Replace empty strings with a readable sentinel for filterable fields
    chunk["industry"] = chunk["industry"].replace("", "Unknown")
    chunk["country"] = chunk["country"].replace("", "Unknown")

    return chunk


# ===========================================================================
# STAGE 3 — ENRICH RECORDS
# ===========================================================================

def _parse_locality(locality: str) -> tuple[str, str]:
    """
    Split 'San Francisco, California' → ('san francisco', 'california').
    Returns ('', '') on failure.
    """
    parts = [p.strip().lower() for p in str(locality or "").split(",") if p.strip()]
    city = parts[0] if parts else ""
    state = parts[1] if len(parts) > 1 else ""
    return city, state


def _industry_tags(industry: str) -> list[str]:
    """Return synonym/alias tags for a given industry label."""
    return _INDUSTRY_TAXONOMY.get(industry.lower().strip(), [])


def _country_tags(country: str) -> list[str]:
    """Return regional/alias tags for a given country label."""
    return _COUNTRY_TAXONOMY.get(country.lower().strip(), [])


def enrich_records(records: list[dict]) -> list[EnrichedRow]:
    """
    Stage 3 | Enrich
    ~~~~~~~~~~~~~~~~
    Derive all computed fields from the raw record dict.

    This stage runs ONCE per row, and its output (the `enriched` list) is
    passed to both Stage 4 (build_texts) and Stage 6 (build_actions) so
    that locality parsing and taxonomy lookups are never duplicated.

    Parameters
    ----------
    records : list of raw record dicts from chunk.to_dict('records').

    Returns
    -------
    list[EnrichedRow] — parallel to `records`.
    Each element is:
        (industry, locality, city, state, industry_tags, size_range, country_tags)
    """
    enriched: list[EnrichedRow] = []
    for row in records:
        industry = row.get("industry", "Unknown")
        locality = row.get("locality", "")
        city, state = _parse_locality(locality)
        tags = _industry_tags(industry)
        ctags = _country_tags(row.get("country", ""))
        size = row.get("size_range", "")
        enriched.append((industry, locality, city, state, tags, size, ctags))
    return enriched


# ===========================================================================
# STAGE 4 — BUILD TEXTS (embedding inputs)
# ===========================================================================

def build_texts(records: list[dict], enriched: list[EnrichedRow]) -> list[str]:
    """
    Stage 4 | Build Texts
    ~~~~~~~~~~~~~~~~~~~~~
    Compose the string passed to the embedding model for each record.

    The format is tuned for msmarco-distilbert-base-tas-b: a dense,
    descriptive sentence covering the fields most used in search
    (name, industry + synonyms, size, location + regional aliases).

    Uses pre-computed `enriched` values from Stage 3 — no re-parsing here.

    Parameters
    ----------
    records  : raw record dicts.
    enriched : parallel list of EnrichedRow tuples from enrich_records().

    Returns
    -------
    list[str] — one input string per record, ready for the encoder.
    """
    texts = []
    for row, (industry, locality, _, state, tags, size, ctags) in zip(records, enriched):
        text = (
            f"company: {row.get('name', '')}. "
            f"industry: {industry} {' '.join(tags)}. "
            f"size: {size}. "
            f"location: {locality}, {state + ', ' if state else ''}"
            f"{row.get('country', 'Unknown')} {' '.join(ctags)}"
        )
        texts.append(text)
    return texts


# ===========================================================================
# STAGE 5 — CREATE EMBEDDINGS
# ===========================================================================

def create_embeddings(
    model: SentenceTransformer,
    texts: list[str],
    encode_batch_size: int = CONFIG.encode_batch_size,
    dim: int = CONFIG.embedding_dim,
) -> list[list[float]]:
    """
    Stage 5 | Embed
    ~~~~~~~~~~~~~~~
    Encode a list of texts into L2-normalised dense vectors.

    The model processes texts in mini-batches of `encode_batch_size`
    (controlled by the encoder, not this function), but the call blocks
    until every vector in `texts` is ready. This guarantees that an entire
    chunk (e.g. 10 000 records) is fully embedded before a single document
    is sent to OpenSearch.

    Falls back to zero-vectors on failure so one bad chunk never aborts
    the full pipeline run. The error is logged with details.

    Parameters
    ----------
    model           : loaded SentenceTransformer instance.
    texts           : output of build_texts().
    encode_batch_size : internal mini-batch size for the encoder.
    dim             : vector dimension — must match the index mapping.

    Returns
    -------
    list[list[float]] — one embedding per input text.
    """
    mini_batches = (len(texts) + encode_batch_size - 1) // encode_batch_size
    logger.info("stage5_encoding", texts=len(texts), mini_batches=mini_batches,
                encode_batch_size=encode_batch_size)
    try:
        return model.encode(
            texts,
            batch_size=encode_batch_size,
            show_progress_bar=False,
            normalize_embeddings=True,  # L2-norm for cosine-equivalent dot-product search
        ).tolist()
    except Exception as e:
        logger.error("stage5_embedding_failed", error=str(e), fallback="zero_vectors")
        return [[0.0] * dim for _ in texts]


# ===========================================================================
# STAGE 6 — BUILD ACTIONS
# ===========================================================================

def build_actions(
    records: list[dict],
    enriched: list[EnrichedRow],
    embeddings: list[list[float]],
    index_name: str,
    indexed_at: str,
    batch_trace_id: str,
) -> list[dict]:
    """
    Stage 6 | Build Actions
    ~~~~~~~~~~~~~~~~~~~~~~~
    Merge raw record data, enriched fields (Stage 3), and embeddings (Stage 5)
    into fully-formed OpenSearch bulk action dicts.

    The `_source` document mirrors the index mapping exactly, including
    `ingestion_batch_id` for traceability across pipeline runs.

    Parameters
    ----------
    records         : raw record dicts from the cleaned chunk.
    enriched        : parallel EnrichedRow list from enrich_records().
    embeddings      : parallel embedding vectors from create_embeddings().
    index_name      : target OpenSearch index.
    indexed_at      : ISO timestamp shared across the whole chunk.
    batch_trace_id  : unique ID for this pipeline run, for observability.

    Returns
    -------
    list[dict] — ready to pass directly to bulk_insert_chunk().
    """
    actions = []
    for row, (industry, locality, city, state, tags, size, ctags), vector in zip(
        records, enriched, embeddings
    ):
        company_id = str(row.get("Unnamed: 0", ""))

        # Build the flat searchable_text field — used by BM25 full-text search
        searchable_text = " ".join(filter(None, [
            row.get("name", ""), industry, " ".join(tags),
            locality, city, state, row.get("country", ""), size, " ".join(ctags),
        ]))

        actions.append({
            "_index": index_name,
            "_id": company_id or None,
            "_source": {
                "company_id": company_id,
                "name": row.get("name", ""),
                "domain": row.get("domain", ""),
                "year_founded": int(row.get("year_founded", 0)),
                "industry": industry,
                "industry_tags": tags,
                "size_range": size,
                "country": row.get("country", "Unknown"),
                "country_tags": ctags,
                "locality": locality,
                "city": city,
                "state": state,
                "searchable_text": searchable_text,
                "current_employee_estimate": int(row.get("current_employee_estimate", 0)),
                "total_employee_estimate": int(row.get("total_employee_estimate", 0)),
                "linkedin_url": row.get("linkedin_url", ""),
                "vector_embedding": vector,
                "indexed_at": indexed_at,
                "ingestion_batch_id": batch_trace_id,
            },
        })
    return actions


# ===========================================================================
# STAGE 7 — BULK INSERT CHUNK
# ===========================================================================

def bulk_insert_chunk(
    client: OpenSearch,
    actions: list[dict],
    bulk_chunk_size: int = CONFIG.bulk_chunk_size,
) -> tuple[int, int]:
    """
    Stage 7 | Insert
    ~~~~~~~~~~~~~~~~
    Send a pre-built list of action dicts to OpenSearch.

    helpers.bulk splits the list into HTTP requests of `bulk_chunk_size`
    documents each (~1.5 MB/request at 500 docs × 3 KB per vector doc).
    Only the first 5 errors are logged to avoid flooding the log on a
    catastrophic failure.

    Parameters
    ----------
    client          : connected OpenSearch client.
    actions         : output of build_actions().
    bulk_chunk_size : docs per HTTP bulk request.

    Returns
    -------
    (success_count, failed_count)
    """
    try:
        ok, errors = helpers.bulk(
            client,
            actions,
            chunk_size=bulk_chunk_size,
            request_timeout=600,
            raise_on_error=False,
        )
        for err in errors[:5]:
            logger.error("stage7_bulk_error", error=err)
        return ok, len(errors)
    except Exception as e:
        logger.error("stage7_bulk_insert_failed", error=str(e))
        return 0, len(actions)


# ===========================================================================
# POST-INGESTION — FINALIZE INDEX
# ===========================================================================

def finalize_index(client: OpenSearch, index_name: str) -> None:
    """
    Post-ingestion cleanup
    ~~~~~~~~~~~~~~~~~~~~~~
    Called once after all chunks have been ingested:

    1. Restore refresh_interval → '1s'
       (was set to '60s' in the index settings during load for throughput).
    2. Restore number_of_replicas → 1
       (was set to 0 during load to skip replication overhead).
    3. Force-refresh so newly indexed docs are immediately searchable.
    4. Force-merge HNSW segments (max 5).
       Without a merge, Faiss HNSW recall degrades significantly because knn
       search must query every segment individually; merging combines them.

    Note: forcemerge can take several minutes on a large index. It is
    non-fatal — failure is logged as a warning, not an error.
    """
    try:
        logger.info("finalize_index_started", index=index_name)

        # Step 1 & 2 — restore production settings
        client.indices.put_settings(
            index=index_name,
            body={"index": {"refresh_interval": "1s", "number_of_replicas": 1}},
        )

        # Step 3 — make docs searchable immediately
        client.indices.refresh(index=index_name)

        # Step 4 — merge HNSW segments for knn performance
        logger.info("finalize_forcemerge_started", index=index_name)
        client.indices.forcemerge(index=index_name, max_num_segments=5)

        logger.info("finalize_index_complete", index=index_name)
    except Exception as e:
        logger.warning("finalize_index_failed", error=str(e))


# ===========================================================================
# ORCHESTRATOR — RUN PIPELINE
# ===========================================================================

def run_pipeline(
    csv_path: str,
    client: OpenSearch,
    model: SentenceTransformer,
    config: PipelineConfig = CONFIG,
) -> dict:
    """
    Orchestrator
    ~~~~~~~~~~~~
    Chain all 7 stages for full CSV ingestion, then finalize the index.

    For each chunk of `config.chunk_size` rows the flow is:

        Stage 1 → read_chunks        yields raw DataFrame chunks
        Stage 2 → clean_chunk        normalise types and fill nulls
        Stage 3 → enrich_records     parse locality, lookup taxonomies
        Stage 4 → build_texts        compose embedding input strings
        Stage 5 → create_embeddings  encode ALL texts in the chunk
                                     (blocks until full chunk is embedded)
        Stage 6 → build_actions      assemble OpenSearch action dicts
        Stage 7 → bulk_insert_chunk  send the full chunk to OpenSearch

        → finalize_index             restore settings, merge segments

    Parameters
    ----------
    csv_path : path to the source CSV file.
    client   : connected OpenSearch client (from create_opensearch_client).
    model    : loaded SentenceTransformer (from load_embedding_model).
    config   : PipelineConfig instance; defaults to the module-level CONFIG.

    Returns
    -------
    dict with keys 'indexed' (int) and 'failed' (int).
    """
    batch_trace_id = generate_trace_id()
    total_indexed = 0
    total_failed = 0

    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("pipeline_started", csv=csv_path, batch_trace_id=batch_trace_id,
                chunk_size=config.chunk_size, device=device,
                parallel=config.parallel_embed_insert)

    # Thread pool for overlapping embedding (GPU/CPU-bound) with bulk insert
    # (network I/O-bound). Python's GIL is released during both C-level
    # PyTorch operations and socket I/O, so real concurrency is achieved.
    executor = ThreadPoolExecutor(max_workers=1) if config.parallel_embed_insert else None
    pending_insert_future = None  # future for the previous chunk's bulk insert

    def _await_pending() -> None:
        """Collect the result of a previously submitted bulk insert future."""
        nonlocal total_indexed, total_failed, pending_insert_future
        if pending_insert_future is not None:
            ok, failed = pending_insert_future.result()
            total_indexed += ok
            total_failed += failed
            pending_insert_future = None

    t_pipeline = time.perf_counter()

    # ── Stage 1: stream chunks ──────────────────────────────────────────────
    for chunk_num, raw_chunk in enumerate(read_chunks(csv_path, config.chunk_size), start=1):
        chunk_rows = len(raw_chunk)
        logger.info("pipeline_chunk_started", chunk=chunk_num, rows=chunk_rows,
                    batch_trace_id=batch_trace_id)

        # ── Stage 2: clean ──────────────────────────────────────────────────
        try:
            chunk = clean_chunk(raw_chunk)
        except Exception as e:
            logger.error("pipeline_clean_failed", chunk=chunk_num, error=str(e),
                         batch_trace_id=batch_trace_id)
            continue  # skip bad chunk, move to the next

        records = chunk.to_dict("records")
        # One timestamp per chunk — avoids datetime.now() per document
        indexed_at = datetime.now().isoformat()

        # ── Stage 3: enrich ─────────────────────────────────────────────────
        enriched = enrich_records(records)
        logger.info("stage3_enrich_complete", chunk=chunk_num, records=len(enriched),
                    batch_trace_id=batch_trace_id)

        # ── Stage 4: build embedding texts ──────────────────────────────────
        texts = build_texts(records, enriched)
        logger.info("stage4_texts_built", chunk=chunk_num, texts=len(texts),
                    batch_trace_id=batch_trace_id)

        # ── Stage 5: create embeddings ──────────────────────────────────────
        # This call blocks until ALL embeddings for the chunk are ready.
        # No document reaches OpenSearch before its vector exists.
        t_embed = time.perf_counter()
        logger.info("pipeline_embedding_started", chunk=chunk_num, records=len(texts),
                    batch_trace_id=batch_trace_id)
        embeddings = create_embeddings(model, texts, config.encode_batch_size, config.embedding_dim)
        embed_ms = round((time.perf_counter() - t_embed) * 1000, 1)
        logger.info("pipeline_embedding_complete", chunk=chunk_num, records=len(embeddings),
                    duration_ms=embed_ms, batch_trace_id=batch_trace_id)

        # ── Stage 6: build action dicts ─────────────────────────────────────
        actions = build_actions(
            records, enriched, embeddings,
            config.index_name, indexed_at, batch_trace_id,
        )

        # ── Stage 7: bulk insert ─────────────────────────────────────────────
        # Wait for the PREVIOUS chunk's insert to finish before submitting
        # the next one (back-pressure: never queue >1 insert at a time).
        _await_pending()

        t_bulk = time.perf_counter()
        logger.info("pipeline_bulk_insert_started", chunk=chunk_num, docs=len(actions),
                    batch_trace_id=batch_trace_id)

        if executor is not None:
            # Submit bulk insert to the thread pool so Stage 5 for the NEXT
            # chunk can start on the GPU while the network I/O happens.
            pending_insert_future = executor.submit(
                _insert_and_log, client, actions, config.bulk_chunk_size,
                chunk_num, batch_trace_id, t_bulk,
            )
        else:
            ok, failed = bulk_insert_chunk(client, actions, config.bulk_chunk_size)
            total_indexed += ok
            total_failed += failed
            logger.info(
                "pipeline_chunk_complete",
                chunk=chunk_num, ok=ok, failed=failed,
                running_total_indexed=total_indexed,
                bulk_duration_ms=round((time.perf_counter() - t_bulk) * 1000, 1),
                batch_trace_id=batch_trace_id,
            )

    # ── Drain the last pending insert ──────────────────────────────────────
    _await_pending()
    if executor is not None:
        executor.shutdown(wait=False)

    pipeline_secs = round(time.perf_counter() - t_pipeline, 1)

    # ── Post-ingestion: restore settings and merge HNSW segments ───────────
    finalize_index(client, config.index_name)

    logger.info("pipeline_complete", indexed=total_indexed, failed=total_failed,
                duration_secs=pipeline_secs, batch_trace_id=batch_trace_id)
    return {"indexed": total_indexed, "failed": total_failed}


def _insert_and_log(
    client: OpenSearch,
    actions: list[dict],
    bulk_chunk_size: int,
    chunk_num: int,
    batch_trace_id: str,
    t_start: float,
) -> tuple[int, int]:
    """Run bulk_insert_chunk and log completion — used by the thread pool."""
    ok, failed = bulk_insert_chunk(client, actions, bulk_chunk_size)
    logger.info(
        "pipeline_chunk_complete",
        chunk=chunk_num, ok=ok, failed=failed,
        bulk_duration_ms=round((time.perf_counter() - t_start) * 1000, 1),
        batch_trace_id=batch_trace_id,
    )
    return ok, failed


# ===========================================================================
# HELPERS — OpenSearch client, index management, model loader
# ===========================================================================

def create_opensearch_client(
    host: str = "localhost",
    port: int = 9200,
    user: str = "",
    password: str = "",
) -> OpenSearch:
    """
    Create and return a configured OpenSearch client.
    User and password default to OPENSEARCH_USER / OPENSEARCH_PASSWORD env vars.
    """
    user = user or os.getenv("OPENSEARCH_USER", "admin")
    password = password or os.getenv("OPENSEARCH_PASSWORD", "")
    client = OpenSearch(
        hosts=[{"host": host, "port": port}],
        http_auth=(user, password),
        use_ssl=True,
        verify_certs=False,
        timeout=30,
    )
    logger.info("opensearch_client_created", host=host, port=port)
    return client


def create_index(client: OpenSearch, index_name: str) -> None:
    """
    Delete (if exists) and create the OpenSearch index from index_mapping.json.
    The mapping JSON lives alongside this file in the data-pipeline directory.
    """
    mapping_path = _BASE / "index_mapping.json"
    with mapping_path.open() as f:
        index_body = json.load(f)

    if client.indices.exists(index_name):
        logger.info("index_exists_deleting", index=index_name)
        client.indices.delete(index=index_name)

    client.indices.create(index=index_name, body=index_body)
    logger.info("index_created", index=index_name)


def load_embedding_model(model_path: str = CONFIG.model_path) -> SentenceTransformer:
    """
    Load and return the SentenceTransformer embedding model.
    Automatically uses GPU if available (CUDA).
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info("model_loading", path=model_path, device=device)
    model = SentenceTransformer(model_path, device=device)
    logger.info("model_loaded", device=device)
    return model


# ===========================================================================
# S3 DOWNLOAD HELPER
# ===========================================================================

def download_from_s3(s3_uri: str, dest_dir: str) -> str:
    """
    Download an S3 object to a local file and return the local path.

    Parameters
    ----------
    s3_uri   : URI in the form ``s3://bucket/key``.
    dest_dir : local directory to write the file into.

    Returns
    -------
    str — absolute path to the downloaded file.
    """
    import boto3

    if not s3_uri.startswith("s3://"):
        raise ValueError(f"Invalid S3 URI: {s3_uri}")

    without_scheme = s3_uri[len("s3://"):]
    bucket, _, key = without_scheme.partition("/")
    if not key:
        raise ValueError(f"S3 URI missing key: {s3_uri}")

    filename = Path(key).name
    local_path = os.path.join(dest_dir, filename)

    logger.info("s3_download_started", bucket=bucket, key=key, dest=local_path)
    s3 = boto3.client("s3")
    s3.download_file(bucket, key, local_path)
    size_mb = os.path.getsize(local_path) / (1024 * 1024)
    logger.info("s3_download_complete", size_mb=round(size_mb, 1))
    return local_path


# ===========================================================================
# CLI ENTRY POINT
# ===========================================================================

def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Intelli-Search data ingestion pipeline")
    parser.add_argument(
        "--csv", default=os.getenv("INGEST_CSV_S3_URI", "companies_sorted.csv"),
        help="Path or s3://bucket/key URI for the source CSV file",
    )
    parser.add_argument(
        "--reset", action="store_true",
        help="Delete and recreate the index before ingesting",
    )
    parser.add_argument("--host", default=os.getenv("OPENSEARCH_HOST", "localhost"), help="OpenSearch host")
    parser.add_argument("--port", type=int, default=int(os.getenv("OPENSEARCH_PORT", "9200")), help="OpenSearch port")
    parser.add_argument(
        "--chunk-size", type=int, default=CONFIG.chunk_size,
        help=f"Rows per CSV chunk (default: {CONFIG.chunk_size})",
    )
    args = parser.parse_args()

    # If the CSV path is an S3 URI, download it to a temp directory first
    csv_path = args.csv
    tmp_dir = None
    if csv_path.startswith("s3://"):
        tmp_dir = tempfile.mkdtemp(prefix="intelli-search-ingest-")
        csv_path = download_from_s3(csv_path, tmp_dir)

    # Override config if chunk size was passed via CLI
    config = PipelineConfig(chunk_size=args.chunk_size)

    # Set up clients
    client = create_opensearch_client(host=args.host, port=args.port)
    model = load_embedding_model()

    # Create index if requested or if it doesn't exist yet
    if args.reset or not client.indices.exists(config.index_name):
        create_index(client, config.index_name)

    # Run the pipeline
    stats = run_pipeline(csv_path, client, model, config)

    print("\n" + "=" * 50)
    print("Ingestion Complete!")
    print("=" * 50)
    print(f"  Documents indexed : {stats['indexed']}")
    print(f"  Documents failed  : {stats['failed']}")
    print("=" * 50)


if __name__ == "__main__":
    main()
