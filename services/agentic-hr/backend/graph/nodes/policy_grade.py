"""
policy_grade node — LLM grades whether retrieved evidence is sufficient
to answer each topic in the question. Supports partial answers when
some topics have evidence and others do not.
"""
import json
import re

from logger import get_logger
from models.state import AgentState
from llm.client import fast_chat
from llm.prompts import EVIDENCE_GRADE_PROMPT

log = get_logger(__name__)


def policy_grade_node(state: AgentState) -> AgentState:
    chunks = state.get("retrieved_chunks") or []
    log.info("Evidence grading | chunks available=%d", len(chunks))

    if not chunks:
        log.warning("No chunks available — evidence insufficient")
        state["evidence_sufficient"] = False
        state["topic_verdicts"] = []
        return state

    evidence_text = "\n\n---\n\n".join(
        f"[{c['child_id']}] {c['content']}" for c in chunks[:6]
    )
    prompt = EVIDENCE_GRADE_PROMPT.format(
        question=state["message"],
        evidence=evidence_text,
    )
    raw = fast_chat(prompt)

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        result = json.loads(match.group()) if match else {"any_sufficient": False, "topics": []}

    topics = result.get("topics", [])
    any_sufficient = bool(result.get("any_sufficient", False))

    state["evidence_sufficient"] = any_sufficient
    state["topic_verdicts"] = topics

    covered = [t["topic"] for t in topics if t.get("sufficient")]
    missing = [t["topic"] for t in topics if not t.get("sufficient")]
    log.info(
        "Evidence grade | any_sufficient=%s | covered=%s | missing=%s",
        any_sufficient, covered, missing,
    )

    if not any_sufficient:
        log.warning("Evidence insufficient for all topics — policy_answer will abstain")
    elif missing:
        log.info("Partial evidence — policy_answer will note missing topics")
    return state
