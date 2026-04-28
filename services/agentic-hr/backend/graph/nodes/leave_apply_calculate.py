"""Calculate leave hours and validate against balance. Pure Python — no LLM calls."""

from logger import get_logger
from mcp.nocodb_client import NocoDBMCPClient
from config import settings
from models.state import AgentState

log = get_logger(__name__)

HOURS_PER_DAY = 8.0

nocodb = NocoDBMCPClient(settings.nocodb_url, settings.nocodb_api_token, settings.nocodb_base_id)


def calculate_leave_hours(duration: float, unit: str) -> float:
    """Convert leave duration to hours. 1 day = 8 hours."""
    if unit == "days":
        return duration * HOURS_PER_DAY
    return duration  # already in hours


def leave_apply_calculate(state: AgentState) -> AgentState:
    """Validate requested leave hours against the employee's current balance.

    Pure Python — no LLM calls. Converts the requested duration to hours
    (1 day = 8 hours), fetches the current balance from NocoDB, and compares.
    Sets leave_apply_sufficient=True and pre-computes leave_apply_new_balance
    when the balance is sufficient. Sets a user-facing error response when
    insufficient or when no balance record exists.

    Args:
        state: AgentState with leave_apply_type, leave_apply_duration,
            leave_apply_unit, and employee_id populated.

    Returns:
        Updated AgentState with leave_apply_hours, leave_apply_sufficient,
        leave_apply_current_balance, leave_apply_new_balance, and
        leave_apply_status set.
    """
    employee_id = state.get("employee_id")
    leave_type = state["leave_apply_type"]
    duration = state["leave_apply_duration"]
    unit = state.get("leave_apply_unit", "days")

    requested_hours = calculate_leave_hours(duration, unit)
    state["leave_apply_hours"] = requested_hours
    log.info(
        "Leave apply calculate | employee_id=%s | type=%s | duration=%s %s | hours=%s",
        employee_id, leave_type, duration, unit, requested_hours,
    )

    balances = nocodb.get_leave_balance(employee_id, leave_type)
    if not balances:
        log.warning("No balance record found | employee_id=%s | type=%s", employee_id, leave_type)
        state["leave_apply_sufficient"] = False
        state["leave_apply_status"] = "no_balance_record"
        state["response"] = (
            f"I couldn't find a {leave_type} leave balance record for you. "
            "Please contact HR for assistance."
        )
        return state

    current_balance = float(balances[0].get("balance_hours", 0))
    state["leave_apply_current_balance"] = current_balance

    if requested_hours > current_balance:
        log.info(
            "Insufficient balance | requested=%.1f | available=%.1f",
            requested_hours, current_balance,
        )
        state["leave_apply_sufficient"] = False
        state["leave_apply_status"] = "insufficient_balance"
        state["leave_apply_new_balance"] = current_balance
        state["response"] = (
            f"Insufficient {leave_type} leave balance. "
            f"You requested **{requested_hours:.1f} hours** "
            f"({duration} {unit}) but only have "
            f"**{current_balance:.1f} hours** available."
        )
        return state

    state["leave_apply_sufficient"] = True
    state["leave_apply_new_balance"] = current_balance - requested_hours
    state["leave_apply_status"] = "calculated"
    log.info(
        "Balance sufficient | available=%.1f | after=%.1f",
        current_balance, state["leave_apply_new_balance"],
    )
    return state
