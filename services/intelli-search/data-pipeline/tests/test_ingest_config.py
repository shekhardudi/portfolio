"""Tests for data-pipeline/ingest_config.yaml schema and values."""
import pytest
from pathlib import Path
import yaml


def test_ingest_config_file_exists():
    path = Path(__file__).parent.parent / "ingest_config.yaml"
    assert path.exists(), "ingest_config.yaml must exist"


def test_required_top_level_keys(ingest_config):
    required = {"index_name", "chunk_size", "embedding_batch_size", "bulk_chunk_size", "embedding", "vector_index"}
    assert required.issubset(ingest_config.keys())


def test_index_name_is_string(ingest_config):
    assert isinstance(ingest_config["index_name"], str)
    assert len(ingest_config["index_name"]) > 0


def test_batch_sizes_are_positive_integers(ingest_config):
    assert isinstance(ingest_config["chunk_size"], int) and ingest_config["chunk_size"] > 0
    assert isinstance(ingest_config["embedding_batch_size"], int) and ingest_config["embedding_batch_size"] > 0
    assert isinstance(ingest_config["bulk_chunk_size"], int) and ingest_config["bulk_chunk_size"] > 0


def test_embedding_section(ingest_config):
    emb = ingest_config["embedding"]
    assert isinstance(emb["model"], str)
    assert isinstance(emb["dimension"], int)
    assert emb["dimension"] > 0


def test_vector_index_section(ingest_config):
    vi = ingest_config["vector_index"]
    assert vi["space_type"] in {"cosinesimil", "l2", "innerproduct"}
    assert isinstance(vi["m"], int) and vi["m"] > 0
    assert isinstance(vi["ef_construction"], int) and vi["ef_construction"] > 0
