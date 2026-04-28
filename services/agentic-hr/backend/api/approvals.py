from fastapi import APIRouter, HTTPException

from logger import get_logger
from models.schemas import ApprovalRequest, PendingApproval
from db.hr import list_access_requests, approve_or_deny_request
from graph.nodes.provision_fulfill import run_fulfillment

router = APIRouter()
log = get_logger(__name__)


@router.get("/approvals", response_model=list[PendingApproval])
def list_approvals():
    """Return all access requests currently in 'pending_approval' status.

    Returns:
        List of PendingApproval objects, each containing request_id, requester
        details, matched packages, status, and created timestamp.

    Raises:
        HTTPException: 502 if the database query fails.
    """
    log.info("GET /approvals — fetching pending requests")
    try:
        requests = list_access_requests(status="pending_approval")
    except Exception as e:
        log.error("Failed to fetch approvals: %s", e)
        raise HTTPException(status_code=502, detail=f"Database error: {e}")

    log.info("GET /approvals — found %d pending request(s)", len(requests))
    result = []
    for r in requests:
        pkg = r.get("package_id", "")
        result.append(
            PendingApproval(
                request_id=r["request_id"],
                requester_email=r.get("requester_email", ""),
                requester_name=r.get("requester_name", ""),
                packages=[pkg] if pkg else [],
                status=r.get("status", "pending_approval"),
                created_ts=str(r.get("created_ts", "")),
            )
        )
    return result


@router.post("/approvals/{request_id}", response_model=dict)
async def decide_approval(request_id: str, body: ApprovalRequest):
    """Record a manager's approval or denial decision for an access request.

    When the decision is "approved", triggers async fulfillment via the
    provisioning clients (Gitea/Mattermost). On fulfillment error, returns
    the approved status with an additional fulfillment_error field so the
    approval record is still preserved.

    Args:
        request_id: The AR-* identifier of the access request to decide on.
        body: ApprovalRequest with decision ("approved" or "denied") and
            approver_email.

    Returns:
        Dict with request_id and status. May include fulfillment_error on
        partial failure.

    Raises:
        HTTPException: 400 if decision is not "approved" or "denied".
        HTTPException: 502 if the database update fails.
    """
    log.info(
        "POST /approvals/%s — decision=%s by %s",
        request_id,
        body.decision,
        body.approver_email,
    )

    if body.decision not in ("approved", "denied"):
        raise HTTPException(status_code=400, detail="decision must be 'approved' or 'denied'")

    try:
        approve_or_deny_request(request_id, body.decision, body.approver_email)
    except Exception as e:
        log.error("Failed to update request %s: %s", request_id, e)
        raise HTTPException(status_code=502, detail=f"Database error: {e}")

    if body.decision == "approved":
        log.info("Request %s approved — triggering fulfillment", request_id)
        try:
            await run_fulfillment(request_id)
            log.info("Fulfillment complete for request %s", request_id)
        except Exception as e:
            log.error("Fulfillment failed for request %s: %s", request_id, e)
            return {"request_id": request_id, "status": "approved", "fulfillment_error": str(e)}
    else:
        log.info("Request %s denied by %s", request_id, body.approver_email)

    return {"request_id": request_id, "status": body.decision}
