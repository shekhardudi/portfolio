"""
audit node — writes a full trace of the request to the audit_events table.
Always runs last, regardless of which worker handled the request.
"""
from logger import get_logger
from models.state import AgentState
from db.audit import write_audit_event

log = get_logger(__name__)


def audit_node(state: AgentState) -> AgentState:
    """Write a full request trace to the audit_events table.

    Always runs as the final node in the graph, regardless of which worker
    handled the request. Derives the worker name from the intent, assembles
    the tools_called list from state flags, and collects RAG evidence metadata
    from retrieved_chunks.

    Audit write failures are caught and logged as non-fatal so they don't
    break the user-facing response.

    Args:
        state: Final AgentState after all worker and compose nodes have run.

    Returns:
        State unchanged — audit_node is a side-effect-only terminal node.
    """
    intent = state.get("intent", "unknown")
    session_id = state.get("session_id")

    worker_map = {
        "leave_balance": "hr_worker",
        "leave_apply": "hr_worker",
        "policy_query": "policy_rag_worker",
        "software_provision": "provisioning_worker",
        "access_request_status": "hr_worker",
        "unsupported": "clarify_or_fallback",
    }
    worker = worker_map.get(intent, "unknown")

    tools_called = []
    if state.get("leave_data"):
        tools_called += ["get_employee_profile", "get_leave_balance"]
    if state.get("leave_apply_status") == "applied":
        tools_called += ["get_leave_balance", "update_leave_balance"]
    if state.get("access_requests_data") is not None:
        tools_called.append("get_access_requests_by_employee")
    if state.get("retrieved_chunks"):
        tools_called += ["vector_search", "fulltext_search"]
    if state.get("request_id"):
        tools_called += ["create_access_request"]
    if state.get("fulfillment_result"):
        result = state["fulfillment_result"]
        if "gitea" in result:
            tools_called.append("provision_gitea")
        if "mattermost" in result:
            tools_called.append("provision_mattermost")

    evidence_used = []
    for chunk in (state.get("retrieved_chunks") or []):
        evidence_used.append({
            "child_id": chunk.get("child_id"),
            "parent_id": chunk.get("parent_id"),
            "score": chunk.get("score"),
        })

    outcome = state.get("approval_status") or state.get("status") or "complete"

    log.info(
        "Audit | session=%s | intent=%s | worker=%s | tools=%s | outcome=%s",
        session_id, intent, worker, tools_called, outcome,
    )

    try:
        write_audit_event(
            session_id=session_id,
            employee_id=state.get("employee_id"),
            employee_email=state.get("employee_email"),
            intent=intent,
            worker=worker,
            tools_called=tools_called,
            evidence_used=evidence_used,
            outcome=outcome,
            response_text=state.get("response"),
            llm_trace={"fast_model": "claude-haiku", "strong_model": "claude-sonnet"},
        )
    except Exception as e:
        log.error("Audit write failed (non-fatal) | session=%s | error=%s", session_id, e)

    return state
