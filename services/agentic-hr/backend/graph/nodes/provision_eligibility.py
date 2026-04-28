"""
provision_eligibility node — rules-based eligibility check (no LLM).
"""
from logger import get_logger
from models.state import AgentState
from db.hr import get_employee_profile

log = get_logger(__name__)


def provision_eligibility_node(state: AgentState) -> AgentState:
    """Apply rules-based eligibility checks for the requested access packages.

    No LLM calls — pure rule evaluation:
    - Employee must have status="active".
    - Employee must have a manager_id on record.
    - Gitea packages (PKG-GH-*) require Engineering department and non-contractor type.

    Fetches the employee profile from the database if it's not already in state.

    Args:
        state: AgentState with employee_email, matched_packages, and optionally
            employee_profile already populated.

    Returns:
        Updated AgentState with eligible (bool) and eligibility_reason set.
    """
    email = state["employee_email"]
    packages = state.get("matched_packages") or []
    log.info("Eligibility check | email=%s | packages=%s", email, packages)

    profile = state.get("employee_profile")
    if not profile:
        log.debug("Profile not in state — fetching from DB | email=%s", email)
        try:
            profile = get_employee_profile(email)
            state["employee_profile"] = profile
        except Exception as e:
            log.error("Eligibility check: failed to fetch profile | email=%s | error=%s", email, e)
            state["eligible"] = False
            state["eligibility_reason"] = f"Could not retrieve employee profile: {e}"
            return state

    if not profile:
        log.warning("Eligibility check: employee not found | email=%s", email)
        state["eligible"] = False
        state["eligibility_reason"] = "Employee record not found."
        return state

    status = profile.get("status", "")
    emp_type = profile.get("employment_type", "")
    department = profile.get("department", "")
    manager_id = profile.get("manager_id", "")

    log.debug(
        "Eligibility profile | email=%s | status=%s | type=%s | dept=%s | manager=%s",
        email, status, emp_type, department, manager_id,
    )

    if status != "active":
        log.warning("Ineligible: status=%s | email=%s", status, email)
        state["eligible"] = False
        state["eligibility_reason"] = f"Employee status is '{status}' — only active employees can request access."
        return state

    if not manager_id:
        log.warning("Ineligible: no manager on record | email=%s", email)
        state["eligible"] = False
        state["eligibility_reason"] = "No manager on record. Please contact HR."
        return state

    gitea_pkgs = [p for p in packages if "GH" in p]
    if gitea_pkgs:
        if emp_type == "contractor":
            log.warning("Ineligible: contractor requesting Gitea access | email=%s", email)
            state["eligible"] = False
            state["eligibility_reason"] = "Contractors are not eligible for Gitea/GitHub access."
            return state
        if department != "Engineering":
            log.warning("Ineligible: non-Engineering dept for Gitea | email=%s | dept=%s", email, department)
            state["eligible"] = False
            state["eligibility_reason"] = (
                f"Gitea/GitHub access is restricted to the Engineering department. "
                f"Your department is '{department}'."
            )
            return state
    
    log.info("Eligibility check passed | email=%s", email)
    state["eligible"] = True
    state["eligibility_reason"] = "Eligible"
    return state
