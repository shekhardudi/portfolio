"""
leave_balance node — HR worker that fetches leave data from NocoDB.
No RAG. No LLM hallucination. Deterministic lookup only.
"""
from logger import get_logger
from models.state import AgentState
from mcp.nocodb_client import NocoDBMCPClient
from config import settings

nocodb = NocoDBMCPClient(settings.nocodb_url, settings.nocodb_api_token, settings.nocodb_base_id)
log = get_logger(__name__)


def leave_balance_node(state: AgentState) -> AgentState:
    """Fetch leave balance data from NocoDB for the resolved employee.

    Performs a deterministic database lookup — no LLM calls. If leave_type
    is present in entities, fetches only that type; otherwise fetches all
    balance records for the employee.

    Args:
        state: AgentState with employee_id and optional entities.leave_type.

    Returns:
        Updated AgentState with leave_data populated on success, or response
        set to an error message when employee_id is missing or lookup fails.
    """
    employee_id = state.get("employee_id")
    entities = state.get("entities") or {}
    leave_type = entities.get("leave_type")

    log.info("Leave balance lookup | employee_id=%s | leave_type=%s", employee_id, leave_type)

    if not employee_id:
        log.warning("No employee_id in state — cannot fetch leave balance | email=%s", state["employee_email"])
        state["leave_data"] = None
        state["response"] = (
            "I couldn't find your employee record. "
            "Please contact HR directly."
        )
        return state

    try:
        balances = nocodb.get_leave_balance(employee_id, leave_type)
        log.info("Leave balances fetched | employee_id=%s | records=%d", employee_id, len(balances))
    except Exception as e:
        log.error("Failed to fetch leave balance | employee_id=%s | error=%s", employee_id, e)
        state["leave_data"] = None
        state["response"] = f"Unable to retrieve leave balance: {e}"
        return state

    state["leave_data"] = {"balances": balances, "employee_id": employee_id}
    return state
