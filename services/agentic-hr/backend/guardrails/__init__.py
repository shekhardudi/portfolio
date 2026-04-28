"""
Guardrails module: PII detection, redaction, and prompt-injection safeguards.

Provides:
- Detector: regex/heuristic pattern matching for PII and prompt-injection
- Redactor: text masking for detected sensitive data
- Policy: mode evaluation and action mapping (warn/block_high_risk/strict)
- Config: guardrail settings and category management
"""

from .detector import Detector, PiiDetection, PromptInjectionDetection
from .redactor import Redactor
from .policy import GuardrailPolicy, GuardrailAction
from .config import PiiCategory, GuardrailConfig

__all__ = [
    "Detector",
    "Redactor",
    "GuardrailPolicy",
    "GuardrailConfig",
    "PiiDetection",
    "PromptInjectionDetection",
    "GuardrailAction",
    "PiiCategory",
]
