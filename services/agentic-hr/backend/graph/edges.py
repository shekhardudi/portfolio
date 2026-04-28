"""
Routing functions for LangGraph conditional edges.
"""
from models.state import AgentState


def route_intent(state: AgentState) -> str:
    """Route from classify_intent to the appropriate next node.

    Sends low-confidence ambiguous messages to clarify, policy queries
    directly to policy_rewrite (no user resolution needed), employee-specific
    intents to resolve_user, and anything else to compose_response as
    unsupported.

    Args:
        state: Current AgentState with intent, confidence, and needs_clarification.

    Returns:
        Node name: "clarify", "resolve_user", "policy_rewrite", or "unsupported".
    """
    if state.get("needs_clarification"):
        return "clarify"
    intent = state.get("intent", "unsupported")
    if intent in ("leave_balance", "leave_apply", "software_provision", "access_request_status"):
        return "resolve_user"
    if intent == "policy_query":
        return "policy_rewrite"
    return "unsupported"


def route_post_resolve(state: AgentState) -> str:
    """Route from resolve_user to the correct worker node.

    Dispatches to the appropriate HR worker based on the intent that was
    already set by classify_intent before user resolution.

    Args:
        state: Current AgentState with intent and resolved employee_id.

    Returns:
        Node name: "leave_balance", "leave_apply_gather", "provision_map",
        "access_request_status", or "unsupported".
    """
    intent = state.get("intent", "unsupported")
    if intent == "leave_balance":
        return "leave_balance"
    if intent == "leave_apply":
        return "leave_apply_gather"
    if intent == "software_provision":
        return "provision_map"
    if intent == "access_request_status":
        return "access_request_status"
    return "unsupported"


def route_eligibility(state: AgentState) -> str:
    """Route from provision_eligibility based on whether the employee is eligible.

    Args:
        state: Current AgentState with eligible flag set by provision_eligibility_node.

    Returns:
        "eligible" to proceed to provision_request, or "ineligible" to
        short-circuit to compose_response with the denial reason.
    """
    if state.get("eligible"):
        return "eligible"
    return "ineligible"


def route_leave_apply_gather(state: AgentState) -> str:
    """Route after leave_apply_gather based on whether all details are collected.

    Args:
        state: Current AgentState with leave_apply_status set to "ready" or
            "missing_info".

    Returns:
        "calculate" if all required leave details are present, "compose" to
        ask the employee for missing information.
    """
    if state.get("leave_apply_status") == "ready":
        return "calculate"
    return "compose"  # missing_info — ask user


def route_leave_apply_calculate(state: AgentState) -> str:
    """Route after leave_apply_calculate based on balance sufficiency.

    Args:
        state: Current AgentState with leave_apply_sufficient flag set by
            leave_apply_calculate.

    Returns:
        "update" to commit the leave deduction to NocoDB, or "compose" to
        inform the employee of insufficient balance.
    """
    if state.get("leave_apply_sufficient"):
        return "update"
    return "compose"  # insufficient balance or no record — tell user
