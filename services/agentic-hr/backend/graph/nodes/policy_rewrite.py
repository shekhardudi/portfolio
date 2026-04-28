"""
policy_rewrite node — expands the employee's question into 2–3 search variants.
"""
import json
import re

from logger import get_logger
from models.state import AgentState
from llm.client import fast_chat
from llm.prompts import QUERY_REWRITE_PROMPT

log = get_logger(__name__)


def policy_rewrite_node(state: AgentState) -> AgentState:
    """Expand the employee's question into 2–3 semantically varied search queries.

    Calls the fast LLM with the query rewrite prompt and parses a JSON list of
    query strings. The original message is always prepended to ensure it is
    included. Falls back gracefully to [original_message] on parse failures.
    The result is capped at 3 variants to control downstream search costs.

    Args:
        state: AgentState with the employee's message.

    Returns:
        Updated AgentState with rewritten_queries list (max 3 entries).
    """
    log.info("Query rewrite | original=%r", state["message"][:80])
    prompt = QUERY_REWRITE_PROMPT.format(question=state["message"])
    raw = fast_chat(prompt)

    try:
        queries = json.loads(raw)
        if not isinstance(queries, list):
            queries = [state["message"]]
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            try:
                queries = json.loads(match.group())
            except Exception:
                queries = [state["message"]]
        else:
            queries = [state["message"]]

    if state["message"] not in queries:
        queries.insert(0, state["message"])

    state["rewritten_queries"] = queries[:3]
    log.info("Query rewrite produced %d variants", len(state["rewritten_queries"]))
    log.debug("Rewritten queries: %s", state["rewritten_queries"])
    return state
