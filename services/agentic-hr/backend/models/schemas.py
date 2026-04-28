from typing import Optional
from pydantic import BaseModel


class ChatRequest(BaseModel):
    """Request body for POST /chat.

    Attributes:
        employee_email: Email address of the employee sending the message.
        message: The employee's message or question text.
        session_id: Optional UUID to group messages in one conversation session.
            Generated automatically by the API if not provided.
    """

    employee_email: str
    message: str
    session_id: Optional[str] = None


class Citation(BaseModel):
    """A policy document citation returned with policy query answers.

    Attributes:
        document: Source document filename (e.g. "hr_policy.pdf").
        section: Section heading within the document.
        chunk_id: Optional child_chunk identifier for deep-linking.
    """

    document: str
    section: str
    chunk_id: Optional[str] = None


class ChatResponse(BaseModel):
    """Response body returned by POST /chat.

    Attributes:
        response: Markdown-formatted answer or clarification question.
        intent: Detected intent label (e.g. "leave_balance", "policy_query").
        citations: List of policy citations for policy_query responses.
        request_id: AR-* identifier when an access request was created.
        status: Outcome status ("complete", "needs_clarification",
            "pending_approval").
    """

    response: str
    intent: Optional[str] = None
    citations: list[Citation] = []
    request_id: Optional[str] = None
    status: str = "complete"


class ApprovalRequest(BaseModel):
    """Request body for POST /approvals/{request_id}.

    Attributes:
        decision: Must be "approved" or "denied".
        approver_email: Email of the manager making the decision.
    """

    decision: str  # "approved" | "denied"
    approver_email: str


class PendingApproval(BaseModel):
    """A single pending access request shown in the manager approval queue.

    Attributes:
        request_id: The AR-* identifier of the request.
        requester_email: Email of the employee who requested access.
        requester_name: Display name of the requesting employee.
        packages: List of access package IDs included in the request.
        status: Current request status (always "pending_approval" in this view).
        created_ts: ISO timestamp string when the request was created.
    """

    request_id: str
    requester_email: str
    requester_name: str = ""
    packages: list[str]
    status: str
    created_ts: str
