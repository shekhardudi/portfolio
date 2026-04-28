"""
Configuration management for the search application.
Handles environment variables and application settings.
"""
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional
from pydantic_settings import BaseSettings
import yaml


class Settings(BaseSettings):
    """Application settings loaded from environment variables"""

    # API Configuration
    API_TITLE: str = "Intelli-Search: Company Search API"
    API_VERSION: str = "1.0.0"
    LOG_LEVEL: str = "INFO"
    ENVIRONMENT: str = "development"

    # OpenSearch Configuration
    OPENSEARCH_HOST: str = "localhost"
    OPENSEARCH_PORT: int = 9200
    OPENSEARCH_USER: str = "admin"
    OPENSEARCH_PASSWORD: str = ""
    OPENSEARCH_VERIFY_CERTS: bool = False
    OPENSEARCH_INDEX_NAME: str = "companies"

    # OpenAI Configuration
    OPENAI_API_KEY: str = ""
    OPENAI_API_BASE: Optional[str] = None
    OPENAI_API_VERSION: Optional[str] = None
    OPENAI_DEPLOYMENT_NAME: Optional[str] = None
    OPENAI_MINI_MODEL: str = "gpt-4o-mini"  
    

    # Tavily Web Search (Optional — used by agentic search for real-time results)
    TAVILY_API_KEY: Optional[str] = None

    # Search Configuration
    SEARCH_TIMEOUT: int = 90  # seconds (agentic path with linkedin enrichment can take 60s+)

    # Features
    ENABLE_SEMANTIC_SEARCH: bool = True
    ENABLE_AGENTIC_SEARCH: bool = True
    ENABLE_QUERY_CLASSIFICATION: bool = True
    ENABLE_CACHING: bool = True
    ENABLE_TRACING: bool = True

    # Intent Classifier Configuration
    CLASSIFIER_CONFIDENCE_THRESHOLD: float = 0.7
    CLASSIFIER_TIMEOUT: int = 10  # seconds

    # Redis Cache
    REDIS_URL: str = "redis://localhost:6379"
    CACHE_TTL_SECONDS: int = 10

    # Tracing & Observability — app sends to OTel Collector via OTLP/gRPC
    OTLP_ENDPOINT: str = "http://localhost:4317"
    OTEL_SERVICE_NAME: str = "intelli-search"

    # Search config file path (relative to backend/ directory or absolute)
    SEARCH_CONFIG_PATH: str = "search_config.yaml"

    class Config:
        env_file = ".env"
        case_sensitive = True

    @property
    def is_production(self) -> bool:
        """Check if running in production"""
        return self.ENVIRONMENT == "production"

    @property
    def is_development(self) -> bool:
        """Check if running in development"""
        return self.ENVIRONMENT == "development"


@lru_cache()
def get_settings() -> Settings:
    """Dependency injection for settings"""
    return Settings()


@lru_cache(maxsize=1)
def get_search_config() -> Dict[str, Any]:
    """Load and cache search_config.yaml from the backend directory."""
    settings = get_settings()
    config_path = Path(settings.SEARCH_CONFIG_PATH)
    if not config_path.is_absolute():
        # Resolve relative to the backend/ directory (parent of app/)
        config_path = Path(__file__).parent.parent / config_path
    with config_path.open() as fh:
        return yaml.safe_load(fh)
