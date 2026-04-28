"""Update NocoDB leave_balances after successful leave application."""

from logger import get_logger
from mcp.nocodb_client import NocoDBMCPClient
from config import settings
from models.state import AgentState

log = get_logger(__name__)

nocodb = NocoDBMCPClient(settings.nocodb_url, settings.nocodb_api_token, settings.nocodb_base_id)


def leave_apply_update(state: AgentState) -> AgentState:
    """Commit the approved leave deduction to NocoDB.

    Fetches the current used_ytd_hours, adds the applied hours, and updates
    both balance_hours and used_ytd_hours in the leave_balances table.
    Sets leave_apply_status to "applied" on success or "update_failed" if
    NocoDB returns a falsy result.

    Args:
        state: AgentState with employee_id, leave_apply_type, leave_apply_hours,
            and leave_apply_new_balance populated.

    Returns:
        Updated AgentState with leave_apply_status set to "applied" or
        "update_failed". On failure, response is set to an error message.
    """
    employee_id = state["employee_id"]
    leave_type = state["leave_apply_type"]
    new_balance = state["leave_apply_new_balance"]
    applied_hours = state["leave_apply_hours"]

    log.info(
        "Leave apply update | employee_id=%s | type=%s | hours=%.1f | new_balance=%.1f",
        employee_id, leave_type, applied_hours, new_balance,
    )

    balances = nocodb.get_leave_balance(employee_id, leave_type)
    current_used = float(balances[0].get("used_ytd_hours", 0)) if balances else 0.0
    new_used = current_used + applied_hours

    result = nocodb.update_leave_balance(
        employee_id=employee_id,
        leave_type=leave_type,
        new_balance_hours=new_balance,
        new_used_hours=new_used,
    )

    if result:
        state["leave_apply_status"] = "applied"
        log.info("Leave balance updated | employee_id=%s | type=%s", employee_id, leave_type)
    else:
        state["leave_apply_status"] = "update_failed"
        state["response"] = (
            "There was an error updating your leave balance. "
            "Please try again or contact HR."
        )
        log.error("Failed to update leave balance | employee_id=%s | type=%s", employee_id, leave_type)

    return state
