"""
Loads all prompt templates from llm/prompt_files/ at import time.
Each prompt uses Python str.format() placeholders, e.g. {message}, {question}.
"""
from pathlib import Path

_PROMPT_DIR = Path(__file__).parent / "prompt_files"


def _load(filename: str) -> str:
    """Read a prompt template file from the prompt_files directory.

    Args:
        filename: Filename relative to llm/prompt_files/ (e.g. "triage.txt").

    Returns:
        The file contents as a UTF-8 string ready for str.format() substitution.
    """
    return (_PROMPT_DIR / filename).read_text(encoding="utf-8")


TRIAGE_PROMPT = _load("triage.txt")
QUERY_REWRITE_PROMPT = _load("query_rewrite.txt")
EVIDENCE_GRADE_PROMPT = _load("evidence_grade.txt")
POLICY_ANSWER_PROMPT = _load("policy_answer.txt")
POLICY_GRADE_ANSWER_PROMPT = _load("policy_grade_answer.txt")
COMPOSE_PROMPT = _load("compose.txt")
