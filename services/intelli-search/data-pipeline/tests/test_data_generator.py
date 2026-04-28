"""Tests for DataIngestionPipeline data_generator() output format."""
import pytest
import pandas as pd
import numpy as np
from unittest.mock import MagicMock, patch


@pytest.fixture
def pipeline():
    """Create a DataIngestionPipeline with a mocked OpenSearch client and embedding service."""
    with patch("ingest_data.OpenSearch") as mock_opensearch_cls, \
         patch("ingest_data.SentenceTransformer") as mock_st_cls:
        mock_client = MagicMock()
        mock_opensearch_cls.return_value = mock_client
        mock_client.indices.exists.return_value = False
        mock_client.indices.create.return_value = {"acknowledged": True}
        mock_client.bulk.return_value = {"errors": False, "items": []}

        mock_model = MagicMock()
        mock_model.encode.return_value = np.ones((2, 768), dtype=np.float32)
        mock_st_cls.return_value = mock_model

        from ingest_data import DataIngestionPipeline
        pipeline = DataIngestionPipeline()
        pipeline.model = mock_model
        yield pipeline


@pytest.fixture
def sample_csv(tmp_path) -> str:
    """Write a tiny CSV file and return its path."""
    df = pd.DataFrame({
        "id": ["c1", "c2"],
        "name": ["Acme Corp", "Beta Ltd"],
        "domain": ["acme.com", "beta.com"],
        "industry": ["technology", "finance"],
        "country": ["US", "GB"],
        "locality": ["San Francisco", "London"],
        "year_founded": [2010, 2005],
        "size_range": ["51-200", "11-50"],
        "current_employee_estimate": [100, 30],
    })
    csv_path = tmp_path / "companies_test.csv"
    df.to_csv(csv_path, index=False)
    return str(csv_path)


def test_data_generator_yields_dicts(pipeline, sample_csv):
    batches = list(pipeline.data_generator(csv_path=sample_csv, chunk_size=10, embedding_batch_size=2))
    assert len(batches) > 0
    first_batch = batches[0]
    assert isinstance(first_batch, list)
    assert isinstance(first_batch[0], dict)


def test_data_generator_document_has_required_fields(pipeline, sample_csv):
    batches = list(pipeline.data_generator(csv_path=sample_csv, chunk_size=10, embedding_batch_size=2))
    doc = batches[0][0]
    for field in ("id", "name", "domain", "industry", "country", "locality", "company_vector"):
        assert field in doc, f"Expected field '{field}' missing from document"


def test_data_generator_vector_dimension(pipeline, sample_csv, ingest_config):
    batches = list(pipeline.data_generator(csv_path=sample_csv, chunk_size=10, embedding_batch_size=2))
    doc = batches[0][0]
    assert len(doc["company_vector"]) == ingest_config["embedding"]["dimension"]


def test_pipeline_index_name_from_config(pipeline, ingest_config):
    assert pipeline.index_name == ingest_config["index_name"]
