import asyncio
import time
import uuid
from typing import Any

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

# ---------------------------------------------------------------------------
# Result cache keyed by client-supplied ``request_id``. Lets a client that
# navigated away mid-call reattach via GET /chat/result/{request_id} once
# they come back to the page — same UX guarantee scout/intelli-search
# already give. The detached task survives client disconnect by writing
# its terminal payload into _RESULT_CACHE before returning, regardless of
# whether the original POST is still listening.
#
# Each entry is (response | exception, completed_at_seconds). We keep
# completions for ``RESULT_TTL_SECONDS`` then drop them on the next access
# so the dict doesn't grow unbounded across long-lived processes.
# ---------------------------------------------------------------------------
RESULT_TTL_SECONDS = 600  # 10 min — comfortably longer than any chat run
_RESULT_CACHE: dict[str, dict[str, Any]] = {}
# Map request_id -> the asyncio.Task running it. Used by the poll endpoint
# to detect "still running" vs "never started" (404).
_REQUEST_TASKS: dict[str, asyncio.Task] = {}


def _evict_expired_results() -> None:
    """Drop completed entries older than ``RESULT_TTL_SECONDS``. Cheap; called
    on cache writes/reads only — no separate sweeper task."""
    now = time.time()
    stale = [rid for rid, entry in _RESULT_CACHE.items()
             if now - entry["completed_at"] > RESULT_TTL_SECONDS]
    for rid in stale:
        _RESULT_CACHE.pop(rid, None)


async def _run_graph_and_cache(
    request_id: str,
    session_id: str,
    initial_state: dict,
) -> ChatResponse:
    """Invoke the compiled LangGraph and stash the terminal payload in the
    result cache. Wrapped so the task survives the client closing the
    underlying HTTP connection — caching happens before we return, so
    GET /chat/result/{request_id} works even if no one is awaiting us."""
    try:
        graph = get_compiled_graph()
        final_state = await graph.ainvoke(initial_state)
        intent = final_state.get("intent")
        status = final_state.get("status") or "complete"
        citations = [Citation(**c) for c in (final_state.get("citations") or [])]
        response = ChatResponse(
            response=final_state.get("response")
                     or "I'm sorry, I couldn't process your request.",
            intent=intent,
            citations=citations,
            request_id=final_state.get("request_id"),
            status=status,
        )
        _RESULT_CACHE[request_id] = {
            "response": response,
            "completed_at": time.time(),
            "session_id": session_id,
        }
        log.info(
            "chat task completed | request_id=%s | session=%s | intent=%s | status=%s",
            request_id, session_id, intent, status,
        )
        return response
    except asyncio.CancelledError:
        # Explicit cancel via DELETE /chat/{session_id}. Don't cache —
        # let the next POST run fresh.
        log.info("chat task cancelled | request_id=%s | session=%s", request_id, session_id)
        raise
    except Exception as exc:
        # Stash the error message so the poll endpoint can surface it
        # rather than spinning forever on the client.
        _RESULT_CACHE[request_id] = {
            "error": str(exc),
            "completed_at": time.time(),
            "session_id": session_id,
        }
        log.error(
            "chat task failed | request_id=%s | session=%s | error=%s",
            request_id, session_id, exc, exc_info=True,
        )
        raise
    finally:
        _evict_expired_results()
        if _INFLIGHT_CHATS.get(session_id) is _REQUEST_TASKS.get(request_id):
            _INFLIGHT_CHATS.pop(session_id, None)
        _REQUEST_TASKS.pop(request_id, None)


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Handle an employee chat message through the LangGraph agent pipeline.

    The graph invocation runs as a *detached* asyncio.Task: the client can
    disconnect (page navigation, tab close) and the LangGraph still completes
    in the background, stashing its terminal payload in ``_RESULT_CACHE``
    keyed by ``request_id``. The frontend can then reattach via
    ``GET /chat/result/{request_id}`` when the user comes back. This mirrors
    the resume semantics scout / intelli-search already provide.

    Args:
        request: Validated ChatRequest containing employee_email, message,
            optional session_id, and optional client-supplied request_id.

    Returns:
        ChatResponse with the agent's response text, detected intent, any
        policy citations, an optional provisioning request_id, and a status
        string (e.g. "complete", "needs_clarification", "pending_approval").

    Raises:
        HTTPException: 500 if the LangGraph pipeline raises an unhandled exception.
    """
    session_id = request.session_id or str(uuid.uuid4())
    request_id = request.request_id or str(uuid.uuid4())
    t0 = time.perf_counter()
    log.info(
        "POST /chat | session=%s | request_id=%s | employee=%s | message=%r",
        session_id, request_id, request.employee_email, request.message[:80],
    )

    # If a prior identical request_id has already completed (the user re-
    # POSTed instead of polling), short-circuit with the cached payload.
    cached = _RESULT_CACHE.get(request_id)
    if cached is not None and "response" in cached:
        return cached["response"]

    # Same request_id is already running — attach to the existing task
    # instead of starting a duplicate. This handles "user refreshed the
    # page mid-call" cleanly: the inbound POST shares the same request_id
    # as the original, so we re-await rather than re-execute.
    existing = _REQUEST_TASKS.get(request_id)
    if existing is not None and not existing.done():
        try:
            return await asyncio.shield(existing)
        except asyncio.CancelledError:
            if existing.cancelled():
                raise HTTPException(status_code=499, detail="Request cancelled.")
            raise

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

    initial_state["guardrail_action"] = guardrail_decision.action.value
    initial_state["guardrail_metadata"] = guardrail_decision.metadata

    log.info(
        "Guardrail check | session=%s | action=%s | reason=%s | metadata=%s",
        session_id,
        guardrail_decision.action.value,
        guardrail_decision.reason,
        guardrail_decision.metadata,
    )

    if guardrail_decision.action == GuardrailAction.BLOCK:
        log.warning(
            "Request blocked by guardrails | session=%s | reason=%s",
            session_id, guardrail_decision.reason,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Request rejected: {guardrail_decision.reason}",
        )

    # If a previous chat for this session is still mid-flight, cancel it —
    # one in-flight chat per session_id, same as before. The newer message
    # supersedes the older one.
    prior = _INFLIGHT_CHATS.get(session_id)
    if prior is not None and not prior.done():
        prior.cancel()

    # Schedule the work as a detached task. We use ``asyncio.shield`` when
    # awaiting so the request being cancelled (e.g. client disconnect) does
    # NOT propagate cancellation into the underlying task — it keeps running
    # and writes its result into _RESULT_CACHE for later poll retrieval.
    invoke_task = asyncio.create_task(
        _run_graph_and_cache(request_id, session_id, initial_state)
    )
    _INFLIGHT_CHATS[session_id] = invoke_task
    _REQUEST_TASKS[request_id] = invoke_task

    try:
        response = await asyncio.shield(invoke_task)
    except asyncio.CancelledError:
        # Two cases collapse here:
        #   1. The HTTP request was cancelled (user navigated). The task
        #      itself is NOT cancelled because of asyncio.shield — it
        #      continues running and will populate _RESULT_CACHE. Re-raise
        #      so FastAPI can clean up the request, and rely on the
        #      frontend's poll loop to pick up the result.
        #   2. The task was explicitly cancelled (DELETE /chat/{session_id}
        #      while we were awaiting). In that case the shield re-raises
        #      and the task itself is cancelled — same handling, return
        #      499 to signal "client closed request".
        if invoke_task.cancelled():
            log.info("Chat cancelled | session=%s | request_id=%s", session_id, request_id)
            raise HTTPException(status_code=499, detail="Request cancelled.")
        log.info(
            "Client disconnected mid-chat — task continues in background | "
            "session=%s | request_id=%s",
            session_id, request_id,
        )
        raise
    except Exception as e:
        log.error(
            "Graph execution failed | session=%s | request_id=%s | error=%s",
            session_id, request_id, e, exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))

    elapsed = time.perf_counter() - t0
    log.info(
        "POST /chat complete | session=%s | request_id=%s | elapsed=%.2fs",
        session_id, request_id, elapsed,
    )
    # Echo the request_id back via header so the client can persist it for
    # later resume polling without having had to mint one before sending.
    response_with_id = response.model_copy()
    return response_with_id


@router.get("/chat/result/{request_id}")
async def chat_result(request_id: str) -> dict[str, Any]:
    """Poll for the result of a detached chat invocation by request_id.

    Returns one of:
      * ``{"status": "running"}`` — task is still executing
      * ``{"status": "completed", "response": <ChatResponse>}`` — done
      * ``{"status": "error", "error": <str>}`` — task raised
      * 404 if request_id is unknown / has expired out of the cache

    Used by the agentic-hr Demo frontend to reattach to an in-flight chat
    after the user navigated away mid-call.
    """
    _evict_expired_results()
    cached = _RESULT_CACHE.get(request_id)
    if cached is not None:
        if "response" in cached:
            return {"status": "completed", "response": cached["response"]}
        if "error" in cached:
            return {"status": "error", "error": cached["error"]}
    task = _REQUEST_TASKS.get(request_id)
    if task is not None and not task.done():
        return {"status": "running"}
    raise HTTPException(status_code=404, detail="Unknown or expired request_id.")


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
