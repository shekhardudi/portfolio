"""provision_request node — creates access request records."""
from logger import get_logger
from models.state import AgentState
from db.hr import get_employee_profile, create_access_request

log = get_logger(__name__)


def provision_request_node(state: AgentState) -> AgentState:
    """Create database access request records for each matched package.

    Inserts one access_request row per package with status "pending_approval"
    and the manager as approver. Stores the first created request_id in state
    and sets approval_status to "pending_approval". Failed individual package
    requests are recorded as "ERROR:..." strings and logged rather than
    aborting the entire operation.

    Args:
        state: AgentState with matched_packages, employee_id, employee_email,
            and optionally employee_profile (to read manager_id).

    Returns:
        Updated AgentState with request_id, approval_status="pending_approval",
        and status="pending_approval".
    """
    packages = state.get("matched_packages") or []
    employee_id = state.get("employee_id") or ""
    email = state["employee_email"]
    log.info("Creating access request(s) | email=%s | packages=%s", email, packages)

    profile = state.get("employee_profile")
    if not profile:
        log.debug("Profile not in state — fetching from DB | email=%s", email)
        try:
            profile = get_employee_profile(email)
        except Exception as e:
            log.error("Could not fetch profile for %s: %s", email, e)
            profile = {}
    approver_id = profile.get("manager_id", "")

    request_ids = []
    for pkg_id in packages:
        try:
            req = create_access_request(
                requester_id=employee_id,
                requester_email=email,
                package_id=pkg_id,
                approver_id=approver_id,
            )
            rid = req.get("request_id", "")
            request_ids.append(rid)
            log.info("Access request created | id=%s | package=%s", rid, pkg_id)
        except Exception as e:
            log.error("Failed to create access request | package=%s | error=%s", pkg_id, e)
            request_ids.append(f"ERROR:{e}")

    state["request_id"] = request_ids[0] if request_ids else None
    state["approval_status"] = "pending_approval"
    state["status"] = "pending_approval"
    log.info("Provisioning request submitted | request_id=%s", state["request_id"])
    return state
