"""
Guardrail configuration and category definitions.
"""

from enum import Enum
from typing import Set, Dict, Any
from dataclasses import dataclass, field


class PiiCategory(str, Enum):
    """Supported PII detection categories."""
    EMAIL = "email"
    PHONE = "phone"
    SSN = "ssn"  # Social Security Number / national ID
    CREDIT_CARD = "credit_card"
    BANK_ACCOUNT = "bank_account"
    DATE_OF_BIRTH = "date_of_birth"
    ADDRESS = "address"


class GuardrailMode(str, Enum):
    """Guardrail enforcement modes."""
    WARN = "warn"  # Log and annotate, no blocking
    BLOCK_HIGH_RISK = "block_high_risk"  # Block high-risk categories (SSN, card, bank)
    STRICT = "strict"  # Block all detected PII


HIGH_RISK_CATEGORIES = {PiiCategory.SSN, PiiCategory.CREDIT_CARD, PiiCategory.BANK_ACCOUNT}


@dataclass
class GuardrailConfig:
    """Central guardrail configuration."""
    mode: GuardrailMode = GuardrailMode.WARN
    enabled_pii_categories: Set[PiiCategory] = field(
        default_factory=lambda: {
            PiiCategory.EMAIL,
            PiiCategory.PHONE,
            PiiCategory.SSN,
            PiiCategory.CREDIT_CARD,
            PiiCategory.BANK_ACCOUNT,
            PiiCategory.DATE_OF_BIRTH,
            PiiCategory.ADDRESS,
        }
    )
    detect_prompt_injection: bool = True
    redact_audit_pii: bool = True
    
    def is_category_enabled(self, category: PiiCategory) -> bool:
        """Check if a PII category is enabled."""
        return category in self.enabled_pii_categories
    
    def is_high_risk(self, category: PiiCategory) -> bool:
        """Check if a category is considered high-risk."""
        return category in HIGH_RISK_CATEGORIES
    
    def should_block(self, category: PiiCategory) -> bool:
        """Determine if detection should trigger a block based on mode and category."""
        if self.mode == GuardrailMode.WARN:
            return False
        elif self.mode == GuardrailMode.BLOCK_HIGH_RISK:
            return self.is_high_risk(category)
        elif self.mode == GuardrailMode.STRICT:
            return True
        return False
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize configuration to dictionary."""
        return {
            "mode": self.mode.value,
            "enabled_pii_categories": [c.value for c in self.enabled_pii_categories],
            "detect_prompt_injection": self.detect_prompt_injection,
            "redact_audit_pii": self.redact_audit_pii,
        }
