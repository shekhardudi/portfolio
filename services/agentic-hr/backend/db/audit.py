"""
Audit event writer — inserts into audit_events table in PostgreSQL.
"""
import json
from datetime import datetime, timezone

from logger import get_logger
from db.connection import ManagedConn
from config import settings
from guardrails.redactor import Redactor

log = get_logger(__name__)


def _apply_audit_redaction(response_text: str | None) -> str | None:
    """Apply PII redaction to audit log entries if enabled in config."""
    if not response_text:
        return response_text
    
    guardrail_config = settings.get_guardrail_config()
    if not guardrail_config.redact_audit_pii:
        return response_text
    
    redactor = Redactor(guardrail_config)
    return redactor.redact_for_audit(response_text)


def write_audit_event(  # noqa: PLR0913
    session_id: str | None,
    employee_id: str | None,
    employee_email: str | None,
    intent: str | None,
    worker: str | None,
    tools_called: list | None = None,
    evidence_used: list | None = None,
    outcome: str | None = None,
    response_text: str | None = None,
    llm_trace: dict | None = None,
) -> None:
    """Insert a full request trace into the audit_events table.

    Called by the audit_node at the end of every graph execution.
    All list/dict fields are serialised to JSON. Missing optional fields
    default to empty collections rather than NULL.

    Args:
        session_id: UUID identifying the chat session.
        employee_id: Internal employee identifier (may be None for unknown users).
        employee_email: Employee email address.
        intent: Classified intent label (e.g. "leave_balance").
        worker: Worker name that handled the request (e.g. "hr_worker").
        tools_called: List of tool/function names invoked during the request.
        evidence_used: List of chunk metadata dicts used for RAG evidence.
        outcome: Final outcome string (e.g. "complete", "pending_approval").
        response_text: The final response delivered to the employee.
        llm_trace: Dict with model metadata (fast_model, strong_model, etc.).
    """
    log.debug(
        "Writing audit event | session=%s | employee=%s | intent=%s | worker=%s | outcome=%s",
        session_id, employee_email, intent, worker, outcome,
    )
    
    # Apply guardrail redaction to response_text if enabled
    redacted_response_text = _apply_audit_redaction(response_text)
    
    sql = """
        INSERT INTO audit_events (
            event_ts, session_id, employee_id, employee_email,
            intent, worker, tools_called, evidence_used,
            outcome, response_text, llm_trace
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s
        )
    """
    now = datetime.now(timezone.utc)
    with ManagedConn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                sql,
                (
                    now,
                    session_id,
                    employee_id,
                    employee_email,
                    intent,
                    worker,
                    json.dumps(tools_called or []),
                    json.dumps(evidence_used or []),
                    outcome,
                    redacted_response_text,
                    json.dumps(llm_trace or {}),
                ),
            )
        conn.commit()
    log.debug("Audit event written | session=%s", session_id)
