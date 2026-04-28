import time
import uuid

from fastapi import APIRouter, HTTPException

from logger import get_logger
from models.schemas import ChatRequest, ChatResponse, Citation
from graph.builder import get_compiled_graph
from config import settings
from guardrails.policy import GuardrailPolicy, GuardrailAction

router = APIRouter()
log = get_logger(__name__)


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Handle an employee chat message through the LangGraph agent pipeline.

    Builds the initial AgentState from the request, invokes the compiled graph,
    and returns a structured ChatResponse. A UUID session_id is generated if
    not provided by the caller.

    Args:
        request: Validated ChatRequest containing employee_email, message, and
            optional session_id.

    Returns:
        ChatResponse with the agent's response text, detected intent, any
        policy citations, an optional provisioning request_id, and a status
        string (e.g. "complete", "needs_clarification", "pending_approval").

    Raises:
        HTTPException: 500 if the LangGraph pipeline raises an unhandled exception.
    """
    session_id = request.session_id or str(uuid.uuid4())
    t0 = time.perf_counter()
    log.info(
        "POST /chat | session=%s | employee=%s | message=%r",
        session_id,
        request.employee_email,
        request.message[:80],
    )

    initial_state = {
        # Identity
        "employee_email": request.employee_email,
        "employee_id": None,
        "employee_profile": None,
        "session_id": session_id,
        "message": request.message,
        # Triage
        "intent": None,
        "entities": None,
        "confidence": None,
        "needs_clarification": False,
        # Leave balance
        "leave_data": None,
        # Leave application
        "leave_apply_type": None,
        "leave_apply_hours": None,
        "leave_apply_duration": None,
        "leave_apply_unit": None,
        "leave_apply_sufficient": None,
        "leave_apply_current_balance": None,
        "leave_apply_new_balance": None,
        "leave_apply_status": None,
        # Access request status
        "access_requests_data": None,
        # Policy RAG
        "rewritten_queries": None,
        "retrieved_chunks": None,
        "parent_sections": None,
        "evidence_sufficient": None,
        "topic_verdicts": None,
        # Provisioning
        "matched_packages": None,
        "eligible": None,
        "eligibility_reason": None,
        "request_id": None,
        "approval_status": None,
        "fulfillment_result": None,
        # Output
        "response": None,
        "citations": [],
        "status": "complete",
    }

    # Guardrail check on inbound request
    guardrail_config = settings.get_guardrail_config()
    guardrail_policy = GuardrailPolicy(guardrail_config)
    guardrail_decision = guardrail_policy.evaluate_inbound(request.message)
    
    # Annotate state with guardrail metadata
    initial_state["guardrail_action"] = guardrail_decision.action.value
    initial_state["guardrail_metadata"] = guardrail_decision.metadata
    
    # Log guardrail decision
    log.info(
        "Guardrail check | session=%s | action=%s | reason=%s | metadata=%s",
        session_id,
        guardrail_decision.action.value,
        guardrail_decision.reason,
        guardrail_decision.metadata,
    )
    
    # Determine if request should be blocked
    if guardrail_decision.action == GuardrailAction.BLOCK:
        log.warning(
            "Request blocked by guardrails | session=%s | reason=%s",
            session_id,
            guardrail_decision.reason,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Request rejected: {guardrail_decision.reason}",
        )

    try:
        graph = get_compiled_graph()
        final_state = await graph.ainvoke(initial_state)
    except Exception as e:
        log.error("Graph execution failed | session=%s | error=%s", session_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    intent = final_state.get("intent")
    status = final_state.get("status") or "complete"
    elapsed = time.perf_counter() - t0
    log.info(
        "POST /chat complete | session=%s | intent=%s | status=%s | elapsed=%.2fs",
        session_id, intent, status, elapsed,
    )

    citations = [Citation(**c) for c in (final_state.get("citations") or [])]
    return ChatResponse(
        response=final_state.get("response") or "I'm sorry, I couldn't process your request.",
        intent=intent,
        citations=citations,
        request_id=final_state.get("request_id"),
        status=status,
    )
