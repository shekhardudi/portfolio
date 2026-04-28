"""
PII Detection Service.

Detects personally identifiable information in text strings.
Used as a guard before routing queries through agentic pipelines that call
external APIs (Tavily, OpenAI) — we must not transmit PII to third parties.

Detection is intentionally conservative: false positives are acceptable
(safe to flag), false negatives are not (unsafe to miss).
"""
import re

_PII_PATTERNS: list[tuple[str, re.Pattern]] = [
    # Email addresses
    ("email", re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", re.I)),
    # Phone numbers (international / local formats)
    ("phone", re.compile(r"(?:\+?\d[\s\-.]?){7,15}\d")),
    # Credit / debit card numbers (13-19 digits with optional separators)
    ("card", re.compile(r"\b(?:\d[\s\-]?){13,19}\b")),
    # SSN: 9 digits, optional dashes (NNN-NN-NNNN or NNNNNNNNN)
    ("ssn", re.compile(r"\b\d{3}[\s\-]?\d{2}[\s\-]?\d{4}\b")),
    # Passport-style IDs: letter(s) + 6-9 digits (broad match)
    ("passport", re.compile(r"\b[A-Z]{1,2}\d{6,9}\b")),
    # Date of birth keywords
    ("dob", re.compile(r"\bdate\s+of\s+birth\b|\bborn\s+on\b|\bdob\b", re.I)),
]


def detect_pii(text: str) -> list[str]:
    """Return a list of PII type labels found in *text*. Empty list means clean."""
    found = []
    for label, pattern in _PII_PATTERNS:
        if pattern.search(text):
            found.append(label)
    return found
