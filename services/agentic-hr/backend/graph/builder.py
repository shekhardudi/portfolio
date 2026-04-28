"""
LangGraph state machine builder.
Constructs and compiles the full agent graph.
"""
from functools import lru_cache

from langgraph.graph import StateGraph, END

from models.state import AgentState
from graph.edges import (
    route_intent,
    route_post_resolve,
    route_eligibility,
    route_leave_apply_gather,
    route_leave_apply_calculate,
)

from graph.nodes.resolve_user import resolve_user
from graph.nodes.classify_intent import classify_intent
from graph.nodes.clarify import clarify
from graph.nodes.leave_balance import leave_balance_node
from graph.nodes.leave_apply_gather import leave_apply_gather
from graph.nodes.leave_apply_calculate import leave_apply_calculate
from graph.nodes.leave_apply_update import leave_apply_update
from graph.nodes.access_request_status import access_request_status_node
from graph.nodes.policy_rewrite import policy_rewrite_node
from graph.nodes.policy_retrieve import policy_retrieve_node
from graph.nodes.policy_expand import policy_expand_node
from graph.nodes.policy_grade_answer import policy_grade_answer_node
from graph.nodes.provision_map import provision_map_node
from graph.nodes.provision_eligibility import provision_eligibility_node
from graph.nodes.provision_request import provision_request_node
from graph.nodes.provision_fulfill import provision_fulfill_node
from graph.nodes.provision_verify import provision_verify_node
from graph.nodes.compose_response import compose_response_node
from graph.nodes.audit import audit_node


def _build_graph():
    """Construct and compile the full LangGraph state machine.

    Registers all 18+ nodes, wires the entry point to classify_intent,
    connects conditional edges for intent routing and pipeline branching,
    and returns a compiled executable graph.

    Returns:
        A compiled LangGraph CompiledGraph ready for ainvoke().
    """
    g = StateGraph(AgentState)

    # Register all nodes
    g.add_node("resolve_user", resolve_user)
    g.add_node("classify_intent", classify_intent)
    g.add_node("clarify", clarify)
    g.add_node("leave_balance", leave_balance_node)
    g.add_node("leave_apply_gather", leave_apply_gather)
    g.add_node("leave_apply_calculate", leave_apply_calculate)
    g.add_node("leave_apply_update", leave_apply_update)
    g.add_node("access_request_status", access_request_status_node)
    g.add_node("policy_rewrite", policy_rewrite_node)
    g.add_node("policy_retrieve", policy_retrieve_node)
    g.add_node("policy_expand", policy_expand_node)
    g.add_node("policy_grade_answer", policy_grade_answer_node)
    g.add_node("provision_map", provision_map_node)
    g.add_node("provision_eligibility", provision_eligibility_node)
    g.add_node("provision_request", provision_request_node)
    g.add_node("provision_fulfill", provision_fulfill_node)
    g.add_node("provision_verify", provision_verify_node)
    g.add_node("compose_response", compose_response_node)
    g.add_node("audit", audit_node)

    # Entry point — classify first, resolve_user only for paths that need employee_id
    g.set_entry_point("classify_intent")

    # Intent routing
    g.add_conditional_edges(
        "classify_intent",
        route_intent,
        {
            "clarify": "clarify",
            "resolve_user": "resolve_user",
            "policy_rewrite": "policy_rewrite",
            "unsupported": "compose_response",
        },
    )

    # resolve_user → dispatch to the correct worker
    g.add_conditional_edges(
        "resolve_user",
        route_post_resolve,
        {
            "leave_balance": "leave_balance",
            "leave_apply_gather": "leave_apply_gather",
            "provision_map": "provision_map",
            "access_request_status": "access_request_status",
            "unsupported": "compose_response",
        },
    )

    # Clarify → done
    g.add_edge("clarify", "compose_response")

    # HR worker — leave balance
    g.add_edge("leave_balance", "compose_response")

    # Leave application pipeline
    g.add_conditional_edges(
        "leave_apply_gather",
        route_leave_apply_gather,
        {
            "calculate": "leave_apply_calculate",
            "compose": "compose_response",
        },
    )
    g.add_conditional_edges(
        "leave_apply_calculate",
        route_leave_apply_calculate,
        {
            "update": "leave_apply_update",
            "compose": "compose_response",
        },
    )
    g.add_edge("leave_apply_update", "compose_response")

    # Access request status
    g.add_edge("access_request_status", "compose_response")

    # Policy RAG pipeline — grade+answer merged into one strong-model call
    g.add_edge("policy_rewrite", "policy_retrieve")
    g.add_edge("policy_retrieve", "policy_expand")
    g.add_edge("policy_expand", "policy_grade_answer")
    g.add_edge("policy_grade_answer", "compose_response")

    # Provisioning pipeline
    g.add_edge("provision_map", "provision_eligibility")
    g.add_conditional_edges(
        "provision_eligibility",
        route_eligibility,
        {
            "eligible": "provision_request",
            "ineligible": "compose_response",
        },
    )
    # provision_request → compose_response (fulfillment is triggered externally after approval)
    g.add_edge("provision_request", "compose_response")

    # Fulfillment path (triggered by approval API, not the main chat flow)
    g.add_edge("provision_fulfill", "provision_verify")
    g.add_edge("provision_verify", "compose_response")

    # All paths converge here
    g.add_edge("compose_response", "audit")
    g.add_edge("audit", END)

    return g.compile()


@lru_cache(maxsize=1)
def get_compiled_graph():
    """Return the singleton compiled LangGraph instance.

    Builds the graph on first call and caches it for the lifetime of the
    process. Subsequent calls return the cached instance without rebuilding.

    Returns:
        The compiled LangGraph state machine.
    """
    return _build_graph()
