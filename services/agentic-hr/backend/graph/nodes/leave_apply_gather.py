"""Gather missing leave application details before calculation."""

from logger import get_logger
from llm.client import fast_chat
from models.state import AgentState

log = get_logger(__name__)

_SYSTEM = (
    "You are an HR assistant helping an employee apply for leave. "
    "Ask ONE short, specific question to gather the missing information."
)

VALID_LEAVE_TYPES = {"annual", "sick", "personal"}


def leave_apply_gather(state: AgentState) -> AgentState:
    """Collect and validate leave application details from the employee message.

    Checks whether leave_type (annual/sick/personal) and duration are present
    in the classified entities. If either is missing, generates a clarification
    question via the fast LLM and sets status to "needs_clarification". When
    both are present, populates the leave_apply_* fields and sets status to
    "ready" for the calculate step.

    Args:
        state: AgentState with entities extracted by classify_intent.

    Returns:
        Updated AgentState. On success: leave_apply_type, leave_apply_duration,
        leave_apply_unit, and leave_apply_status="ready". On missing info:
        response set to clarification question and status="needs_clarification".
    """
    entities = state.get("entities") or {}
    leave_type = entities.get("leave_type")
    duration = entities.get("leave_duration")
    unit = entities.get("leave_unit", "days")

    log.info(
        "Leave apply gather | leave_type=%s | duration=%s | unit=%s",
        leave_type, duration, unit,
    )

    missing = []
    if not leave_type or leave_type not in VALID_LEAVE_TYPES:
        missing.append("leave type (annual, sick, or personal)")
    if not duration:
        missing.append("duration (number of days or hours)")

    if missing:
        prompt = (
            f"Employee message: {state['message']}\n\n"
            f"Missing information: {', '.join(missing)}.\n"
            "Ask ONE clarification question to get this information."
        )
        state["response"] = fast_chat(prompt, system=_SYSTEM)
        state["leave_apply_status"] = "missing_info"
        state["status"] = "needs_clarification"
        log.info("Leave apply — missing info: %s", missing)
        return state

    state["leave_apply_type"] = leave_type
    state["leave_apply_duration"] = float(duration)
    state["leave_apply_unit"] = unit
    state["leave_apply_status"] = "ready"
    log.info(
        "Leave apply — all info present | type=%s | duration=%s %s",
        leave_type, duration, unit,
    )
    return state
