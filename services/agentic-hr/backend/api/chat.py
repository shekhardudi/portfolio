import asyncio
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


# ---------------------------------------------------------------------------
# In-flight chat task registry. Keyed by ``session_id`` so DELETE
# /chat/{session_id} can cancel a long-running LangGraph invocation and
# free the worker slot in real time. A given session_id can only have one
# in-flight chat at a time — starting a second one cancels the first.
# ---------------------------------------------------------------------------
_INFLIGHT_CHATS: dict[str, asyncio.Task] = {}


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
        # Wrap the invocation as an asyncio.Task so DELETE /chat/{session_id}
        # can cancel it via task.cancel(). If a prior task for this session_id
        # is still running (race — the user fired two messages back-to-back),
        # cancel it first so we don't leak workers.
        prior = _INFLIGHT_CHATS.get(session_id)
        if prior is not None and not prior.done():
            prior.cancel()

        invoke_task = asyncio.create_task(graph.ainvoke(initial_state))
        _INFLIGHT_CHATS[session_id] = invoke_task
        try:
            final_state = await invoke_task
        finally:
            # Drop the registry entry only if it still points at our task —
            # avoid clobbering a newer task that took the slot.
            if _INFLIGHT_CHATS.get(session_id) is invoke_task:
                _INFLIGHT_CHATS.pop(session_id, None)
    except asyncio.CancelledError:
        log.info("Chat cancelled by client | session=%s", session_id)
        raise HTTPException(status_code=499, detail="Request cancelled.")
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


@router.delete("/chat/{session_id}", status_code=202)
async def cancel_chat(session_id: str) -> dict:
    """Cancel an in-flight LangGraph chat invocation for ``session_id``.

    Returns 202 even when no task is found so the client doesn't need to
    race against a server that just finished. The cancelled task will
    propagate ``CancelledError`` out of ``await graph.ainvoke(...)``,
    freeing the worker slot.
    """
    task = _INFLIGHT_CHATS.get(session_id)
    if task is None:
        return {"session_id": session_id, "cancelled": False, "reason": "not_found"}
    if task.done():
        return {"session_id": session_id, "cancelled": False, "reason": "already_done"}
    task.cancel()
    log.info("Chat cancel requested | session=%s", session_id)
    return {"session_id": session_id, "cancelled": True}
