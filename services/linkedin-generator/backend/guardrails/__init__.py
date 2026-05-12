"""
Guardrails module: PII detection, redaction, and prompt-injection safeguards.

Provides:
- Detector: regex/heuristic pattern matching for PII and prompt-injection
- Redactor: text masking for detected sensitive data
- Policy: mode evaluation and action mapping (warn/block_high_risk/strict)
- Config: guardrail settings and category management
- get_input_policy() / get_output_policy(): cached singletons tuned for the
  linkedin-generator service's four chokepoints.
"""

from .detector import Detector, PiiDetection, PromptInjectionDetection
from .redactor import Redactor
from .policy import GuardrailPolicy, GuardrailAction
from .config import PiiCategory, GuardrailConfig, GuardrailMode

# ---------------------------------------------------------------------------
# Per-chokepoint policies.
#
# We enable ONLY email + phone PII categories at every chokepoint — names
# pass through unchanged so attribution ("Andrej Karpathy said X") survives
# all four boundaries. SSN / credit-card / bank-account / DOB / address are
# left out: they shouldn't appear in scout/crew content, and DOB heuristics
# would otherwise collide with publication-date strings.
#
# Prompt-injection detection is ON at input chokepoints (untrusted web
# content into the extractor; user-supplied topic/leader_angle/vibe into
# the crew) and OFF at output chokepoints (would false-positive on legit
# LLM output that happens to discuss prompt engineering).
# ---------------------------------------------------------------------------
_input_policy: GuardrailPolicy | None = None
_output_policy: GuardrailPolicy | None = None


def get_input_policy() -> GuardrailPolicy:
    """Cached policy for untrusted-content boundaries (scout extractor input,
    crew API input). Email+phone PII (redact) + prompt-injection (block)."""
    global _input_policy
    if _input_policy is None:
        _input_policy = GuardrailPolicy(GuardrailConfig(
            mode=GuardrailMode.BLOCK_HIGH_RISK,
            enabled_pii_categories={PiiCategory.EMAIL, PiiCategory.PHONE},
            detect_prompt_injection=True,
        ))
    return _input_policy


def get_output_policy() -> GuardrailPolicy:
    """Cached policy for LLM-output boundaries (crew final post, scout
    synthesis). Email+phone PII redaction only — no injection check."""
    global _output_policy
    if _output_policy is None:
        _output_policy = GuardrailPolicy(GuardrailConfig(
            mode=GuardrailMode.BLOCK_HIGH_RISK,
            enabled_pii_categories={PiiCategory.EMAIL, PiiCategory.PHONE},
            detect_prompt_injection=False,
        ))
    return _output_policy


# Cached redactor reused at output chokepoints — its detector is configured
# to the output policy's restricted (email+phone-only) category set.
_output_redactor: Redactor | None = None


def scrub_output(text: str) -> str:
    """Strip emails / phone numbers from LLM-generated text.

    Names, dates, and free-form content pass through unchanged. Used at the
    crew final-post and scout synthesis boundaries to scrub stray PII
    without losing attribution.
    """
    global _output_redactor
    if not text:
        return text
    if _output_redactor is None:
        _output_redactor = Redactor(get_output_policy().config)
    return _output_redactor.redact(text)


def scrub_input(text: str) -> tuple[str, GuardrailAction, str]:
    """Evaluate untrusted-content input against the input policy.

    Returns ``(scrubbed_text, action, reason)``:
      * ``action == BLOCK``  → prompt-injection match. Caller should refuse
        the request or replace content with a placeholder. ``scrubbed_text``
        echoes the original (caller decides redaction policy).
      * ``action == REDACT`` → email/phone PII detected. ``scrubbed_text``
        already has them masked.
      * ``action == ALLOW``  → no detections, ``scrubbed_text == text``.
      * ``action == WARN``   → mode-dependent fallback; treated as ALLOW for
        the caller's purposes, with the reason surfaced for logging.
    """
    if not text:
        return text, GuardrailAction.ALLOW, ""
    policy = get_input_policy()
    decision = policy.evaluate_inbound(text)
    if decision.action == GuardrailAction.BLOCK:
        return text, GuardrailAction.BLOCK, decision.reason
    if decision.pii_detections:
        # Lazily build a redactor against the input policy's restricted
        # category set so we only ever strip emails/phones here.
        redactor = Redactor(policy.config)
        return redactor.redact(text), GuardrailAction.REDACT, decision.reason
    return text, decision.action, decision.reason


__all__ = [
    "Detector",
    "Redactor",
    "GuardrailPolicy",
    "GuardrailConfig",
    "GuardrailMode",
    "PiiDetection",
    "PromptInjectionDetection",
    "GuardrailAction",
    "PiiCategory",
    "get_input_policy",
    "get_output_policy",
    "scrub_input",
    "scrub_output",
]
