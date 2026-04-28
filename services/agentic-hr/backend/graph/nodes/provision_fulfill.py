"""
provision_fulfill node — calls Gitea and/or Mattermost MCP clients
to actually provision access after manager approval.
"""
import json

from logger import get_logger
from models.state import AgentState
from db.hr import (
    get_employee_profile,
    get_employee_by_id,
    get_access_request,
    get_access_package,
    update_request_fulfillment,
)
from mcp.gitea_client import GiteaMCPClient
from mcp.mattermost_client import MattermostMCPClient
from config import settings

gitea = GiteaMCPClient(settings.gitea_url, settings.gitea_admin_token)
mattermost = MattermostMCPClient(settings.mattermost_url, settings.mattermost_admin_token)
log = get_logger(__name__)


def _fulfill_package(package: dict, employee_profile: dict) -> dict:
    """Dispatch provisioning for a single access package.

    Detects the target system from the package_id ("GH" → Gitea, "SL" →
    Mattermost) and calls the appropriate client. Payload is JSON-decoded
    when stored as a string.

    Args:
        package: Access package dict with package_id and payload.
        employee_profile: Employee dict with email, full_name, github_username.

    Returns:
        Dict with package_id and nested system result keys ("gitea", "mattermost").
    """
    pkg_id = package.get("package_id", "")
    payload = package.get("payload", {})
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}

    result = {"package_id": pkg_id}

    if "GH" in pkg_id:
        org = payload.get("org", "agentic-hr")
        team = payload.get("team", "engineering")
        username = employee_profile.get("github_username", "")
        email = employee_profile.get("email", "")
        full_name = employee_profile.get("full_name", "")
        log.info("Fulfilling Gitea access | org=%s | team=%s | username=%s", org, team, username)
        result["gitea"] = gitea.provision(org, team, username, email=email, full_name=full_name)

    if "SL" in pkg_id:
        team = payload.get("team", "engineering")
        channels = payload.get("channels", ["general"])
        email = employee_profile.get("email", "")
        log.info("Fulfilling Mattermost access | team=%s | channels=%s | user=%s", team, channels, email)
        result["mattermost"] = mattermost.provision(team, channels, email)

    return result


def provision_fulfill_node(state: AgentState) -> AgentState:
    """Fulfill an approved access request by calling the external provisioning APIs.

    Looks up the access request and package from the database, then calls
    _fulfill_package() to dispatch to Gitea/Mattermost. Updates the database
    record and sets fulfillment_result in state. Errors are caught and stored
    in fulfillment_result rather than propagating.

    Args:
        state: AgentState with request_id and employee_email.

    Returns:
        Updated AgentState with fulfillment_result and approval_status="fulfilled"
        on success, or fulfillment_result={"error": ...} on failure.
    """
    request_id = state.get("request_id")
    email = state["employee_email"]
    log.info("Fulfilling provisioning | request_id=%s | email=%s", request_id, email)

    try:
        profile = state.get("employee_profile")
        if not profile:
            log.debug("Profile not in state — fetching from DB | email=%s", email)
            profile = get_employee_profile(email) or {}

        req = get_access_request(request_id) if request_id else None
        if not req:
            log.error("Fulfillment: access request not found | id=%s", request_id)
            state["fulfillment_result"] = {"error": "Request not found"}
            return state

        pkg = get_access_package(req["package_id"]) or {}
        result = _fulfill_package(pkg, profile)

        update_request_fulfillment(request_id, result)
        state["fulfillment_result"] = result
        state["approval_status"] = "fulfilled"
        log.info("Fulfillment complete | request_id=%s | result=%s", request_id, result)
    except Exception as e:
        log.error("Fulfillment failed | request_id=%s | error=%s", request_id, e, exc_info=True)
        state["fulfillment_result"] = {"error": str(e)}

    return state


async def run_fulfillment(request_id: str) -> dict:
    """Called by the approvals API endpoint after manager approval."""
    log.info("run_fulfillment triggered | request_id=%s", request_id)
    try:
        req = get_access_request(request_id)
        if not req:
            log.warning("run_fulfillment: request not found | id=%s", request_id)
            return {"error": "Request not found"}

        requester_id = req.get("requester_id", "")
        profile = get_employee_by_id(requester_id) if requester_id else {}
        profile = profile or {}
        pkg = get_access_package(req["package_id"]) or {}
        result = _fulfill_package(pkg, profile)
        update_request_fulfillment(request_id, result)
        log.info("run_fulfillment complete | request_id=%s", request_id)
        return result
    except Exception as e:
        log.error("run_fulfillment error | request_id=%s | error=%s", request_id, e, exc_info=True)
        return {"error": str(e)}
