import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class Settings(BaseSettings):
    # LLM provider: "anthropic" or "openai"
    llm_provider: str = "anthropic"

    # Anthropic
    anthropic_api_key: str = ""

    # OpenAI
    openai_api_key: str = ""

    # PostgreSQL
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "agentic_hr"
    postgres_password: str = "agentic_hr_dev"
    postgres_db: str = "agentic_hr"

    # NocoDB
    nocodb_url: str = "http://localhost:8080"
    nocodb_api_token: str = ""
    nocodb_base_id: str = ""

    # Gitea
    gitea_url: str = "http://localhost:3000"
    gitea_admin_token: str = ""

    # Mattermost
    mattermost_url: str = "http://localhost:8065"
    mattermost_admin_token: str = ""

    # LLM
    llm_fast_model: str = "claude-haiku-4-5-20251001"
    llm_strong_model: str = "claude-sonnet-4-6"

    # Embedding
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    # Backend
    backend_port: int = 8000

    # Guardrails: PII detection and prompt-injection safeguards
    guardrail_mode: str = "warn"  # "warn", "block_high_risk", or "strict"
    guardrail_enabled_pii_categories: str = "email,phone,ssn,credit_card,bank_account,date_of_birth,address"
    guardrail_detect_prompt_injection: bool = True
    guardrail_audit_redact_pii: bool = True

    class Config:
        extra = "ignore"

    @property
    def postgres_dsn(self) -> str:
        return (
            f"host={self.postgres_host} port={self.postgres_port} "
            f"dbname={self.postgres_db} user={self.postgres_user} "
            f"password={self.postgres_password}"
        )

    def get_guardrail_config(self):
        """Create a GuardrailConfig instance from this settings object."""
        from guardrails.config import GuardrailConfig, GuardrailMode, PiiCategory

        # Parse enabled categories from comma-separated string
        enabled_categories = set()
        for category_str in self.guardrail_enabled_pii_categories.split(","):
            category_str = category_str.strip().lower()
            try:
                enabled_categories.add(PiiCategory(category_str))
            except ValueError:
                # Skip invalid categories
                pass

        return GuardrailConfig(
            mode=GuardrailMode(self.guardrail_mode),
            enabled_pii_categories=enabled_categories,
            detect_prompt_injection=self.guardrail_detect_prompt_injection,
            redact_audit_pii=self.guardrail_audit_redact_pii,
        )


settings = Settings()
