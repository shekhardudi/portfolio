"""Shared fixtures for data-pipeline tests."""
import pytest
from pathlib import Path
import yaml

PIPELINE_ROOT = Path(__file__).parent.parent


@pytest.fixture
def ingest_config() -> dict:
    """Load the real ingest_config.yaml for integration-style tests."""
    config_path = PIPELINE_ROOT / "ingest_config.yaml"
    with config_path.open() as fh:
        return yaml.safe_load(fh)
