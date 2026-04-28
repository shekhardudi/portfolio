"""
Prompt Loader Service.

Centralised loader for prompt template files stored in app/prompts/.
Reading happens at module import time so missing files raise FileNotFoundError
on startup — configuration errors surface immediately rather than at
first request.
"""
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(filename: str) -> str:
    """Load a prompt template from the prompts directory."""
    path = _PROMPTS_DIR / filename
    return path.read_text(encoding="utf-8")
