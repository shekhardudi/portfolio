from typing import TypedDict, Optional


class AgentState(TypedDict):
    """Shared state passed between all LangGraph nodes for a single request.

    Each node receives the full state, makes its changes, and returns the
    updated state. Fields are grouped by the node that populates them.

    Identity fields (set by API layer):
        employee_email: The authenticated employee's email address.
        employee_id: Internal ID resolved by resolve_user from NocoDB/DB.
        employee_profile: Full employee record dict from the data source.
        session_id: UUID for this conversation session.
        message: The raw employee message text.

    Triage fields (set by classify_intent):
        intent: Classified intent label.
        entities: Dict of extracted entities (leave_type, systems, etc.).
        confidence: Float 0–1 confidence score from the LLM.
        needs_clarification: True when confidence < 0.6 and intent unsupported.

    Leave balance fields (set by leave_balance_node):
        leave_data: Dict with 'balances' list and 'employee_id'.

    Policy RAG fields (set by policy_* nodes):
        rewritten_queries: Expanded query variants for hybrid search.
        retrieved_chunks: Top fused child chunks from RAG retrieval.
        parent_sections: Expanded parent sections for evidence context.
        evidence_sufficient: Whether retrieved evidence answers the question.
        topic_verdicts: Per-topic grading results from the strong model.

    Provisioning fields (set by provision_* nodes):
        matched_packages: Access package IDs matched to the request.
        eligible: Whether the employee is eligible for the requested access.
        eligibility_reason: Human-readable reason for eligibility decision.
        request_id: Created AR-* identifier for the access request.
        approval_status: Current approval workflow status string.
        fulfillment_result: Dict with provisioning system outcomes.

    Leave application fields (set by leave_apply_* nodes):
        leave_apply_type: Leave type being applied for (annual/sick/personal).
        leave_apply_hours: Requested duration converted to hours.
        leave_apply_duration: Raw numeric duration from the employee.
        leave_apply_unit: Unit string ("days" or "hours").
        leave_apply_sufficient: True when balance covers the request.
        leave_apply_current_balance: Balance before deduction (hours).
        leave_apply_new_balance: Balance after deduction (hours).
        leave_apply_status: Pipeline stage status string.

    Access request status fields (set by access_request_status_node):
        access_requests_data: List of access request records for the employee.

    Output fields (set by compose_response_node):
        response: Final Markdown response string delivered to the employee.
        citations: List of citation dicts (document, section, chunk_id).
        status: Top-level request outcome for API response classification.
    """
    # Identity
    employee_email: str
    employee_id: Optional[str]
    employee_profile: Optional[dict]
    session_id: Optional[str]
    message: str

    # Triage
    intent: Optional[str]           # leave_balance | policy_query | software_provision | unsupported
    entities: Optional[dict]
    confidence: Optional[float]
    needs_clarification: bool

    # HR worker
    leave_data: Optional[dict]

    # Policy RAG worker
    rewritten_queries: Optional[list]
    retrieved_chunks: Optional[list]
    parent_sections: Optional[list]
    evidence_sufficient: Optional[bool]
    topic_verdicts: Optional[list]

    # Provisioning worker
    matched_packages: Optional[list]
    eligible: Optional[bool]
    eligibility_reason: Optional[str]
    request_id: Optional[str]
    approval_status: Optional[str]
    fulfillment_result: Optional[dict]

    # Leave application
    leave_apply_type: Optional[str]
    leave_apply_hours: Optional[float]
    leave_apply_duration: Optional[float]
    leave_apply_unit: Optional[str]
    leave_apply_sufficient: Optional[bool]
    leave_apply_current_balance: Optional[float]
    leave_apply_new_balance: Optional[float]
    leave_apply_status: Optional[str]

    # Access request status
    access_requests_data: Optional[list]

    # Output
    response: Optional[str]
    citations: Optional[list]
    status: Optional[str]
