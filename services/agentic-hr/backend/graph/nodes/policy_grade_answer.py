"""
policy_grade_answer node — grades evidence sufficiency AND generates a cited answer
in a single strong-model call, replacing the separate policy_grade + policy_answer nodes.

This saves one sequential LLM round-trip (~0.5–1 s) on every policy query.
"""
import json
import re
import time

from logger import get_logger
from models.state import AgentState
from llm.client import strong_chat
from llm.prompts import POLICY_GRADE_ANSWER_PROMPT

log = get_logger(__name__)


def policy_grade_answer_node(state: AgentState) -> AgentState:
    """Grade evidence sufficiency and generate a cited policy answer in one LLM call.

    Combines the evidence grading and answer generation steps that were
    previously two separate nodes. Uses the strong model to evaluate whether
    the top 6 retrieved chunks contain sufficient evidence and to produce a
    Markdown answer with inline citations.

    When no chunks are available, returns a graceful abstention response.
    Falls back to the raw model output when JSON parsing fails.

    Args:
        state: AgentState with retrieved_chunks and parent_sections populated.

    Returns:
        Updated AgentState with evidence_sufficient, topic_verdicts, response
        (Markdown answer), and citations list set.
    """
    chunks = state.get("retrieved_chunks") or []
    parent_sections = state.get("parent_sections") or []

    if not chunks:
        log.warning("No chunks — abstaining from policy answer")
        closest = parent_sections[0] if parent_sections else None
        if closest:
            state["response"] = (
                f"I found related sections in '{closest['filename']}' "
                f"(section: {closest['heading']}) but not enough evidence to answer confidently. "
                "Please contact the HR team directly."
            )
            state["citations"] = [{
                "document": closest["filename"],
                "section": closest["heading"],
                "chunk_id": None,
            }]
        else:
            state["response"] = (
                "I couldn't find relevant HR policy information to answer your question. "
                "Please contact the HR team directly."
            )
            state["citations"] = []
        state["evidence_sufficient"] = False
        state["topic_verdicts"] = []
        return state

    parent_map = {p["parent_id"]: p for p in parent_sections}
    evidence_parts = []
    for c in chunks[:6]:
        parent = parent_map.get(c["parent_id"], {})
        filename = parent.get("filename", "unknown")
        heading = parent.get("heading", "")
        evidence_parts.append(
            f"[{c['child_id']}] Source: {filename} — {heading}\n{c['content']}"
        )
    evidence_text = "\n\n---\n\n".join(evidence_parts)

    log.info(
        "Policy grade+answer | evidence_chunks=%d | parent_sections=%d",
        len(chunks), len(parent_sections),
    )
    t0 = time.perf_counter()

    prompt = POLICY_GRADE_ANSWER_PROMPT.format(
        question=state["message"],
        evidence=evidence_text,
    )
    raw = strong_chat(prompt)
    elapsed = time.perf_counter() - t0
    log.info("Policy grade+answer complete | elapsed=%.2fs", elapsed)

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        result = json.loads(match.group()) if match else {"answer": raw, "citations": [], "any_sufficient": True}

    topics = result.get("topics", [])
    any_sufficient = bool(result.get("any_sufficient", True))

    state["evidence_sufficient"] = any_sufficient
    state["topic_verdicts"] = topics
    state["response"] = result.get("answer", raw)
    state["citations"] = result.get("citations", [])

    covered = [t["topic"] for t in topics if t.get("sufficient")]
    missing = [t["topic"] for t in topics if not t.get("sufficient")]
    log.info(
        "Policy answer | any_sufficient=%s | covered=%s | missing=%s | citations=%d",
        any_sufficient, covered, missing, len(state["citations"]),
    )
    return state
