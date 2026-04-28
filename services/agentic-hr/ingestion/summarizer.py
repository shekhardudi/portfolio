"""
summarizer.py — generates a concise summary for each parent section using the LLM.
"""
import anthropic

from config import ANTHROPIC_API_KEY, SUMMARIZER_MODEL
from logger import get_logger

log = get_logger(__name__)


def summarize_section(heading: str, content: str) -> str:
    """Ask the LLM to produce a concise summary of a policy section."""
    if not ANTHROPIC_API_KEY:
        log.warning("ANTHROPIC_API_KEY not set — using placeholder summary for section %r", heading[:60])
        return f"Summary of section: {heading}"

    log.debug("Summarising section | heading=%r | content_len=%d", heading[:60], len(content))
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = (
        f"Summarize the following HR policy section in 2–3 sentences.\n"
        f"Focus on: what the policy covers, who it applies to, and any key conditions or exceptions.\n\n"
        f"## {heading}\n\n{content[:3000]}"
    )
    resp = client.messages.create(
        model=SUMMARIZER_MODEL,
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}],
    )
    summary = resp.content[0].text.strip()
    log.debug("Summary generated | heading=%r | summary_len=%d", heading[:60], len(summary))
    return summary
