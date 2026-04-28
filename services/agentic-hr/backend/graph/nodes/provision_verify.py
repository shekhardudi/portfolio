"""
provision_verify node — verifies that provisioning actually took effect.
"""
from logger import get_logger
from models.state import AgentState
from mcp.gitea_client import GiteaMCPClient
from mcp.mattermost_client import MattermostMCPClient
from mcp.nocodb_client import NocoDBMCPClient
from config import settings

nocodb = NocoDBMCPClient(settings.nocodb_url, settings.nocodb_api_token, settings.nocodb_base_id)
gitea = GiteaMCPClient(settings.gitea_url, settings.gitea_admin_token)
mattermost = MattermostMCPClient(settings.mattermost_url, settings.mattermost_admin_token)
log = get_logger(__name__)


def provision_verify_node(state: AgentState) -> AgentState:
    """Verify that provisioning actions took effect on the target systems.

    Checks fulfillment_result for "gitea" and "mattermost" keys and calls
    the corresponding client verify methods. Verification results are merged
    back into fulfillment_result under a "verifications" key.

    Args:
        state: AgentState with fulfillment_result and employee_email set
            by provision_fulfill_node.

    Returns:
        Updated AgentState with fulfillment_result enriched with verifications
        dict mapping system name → bool.
    """
    email = state["employee_email"]
    result = state.get("fulfillment_result") or {}
    log.info("Verifying provisioning | email=%s | systems=%s", email, list(result.keys()))

    verifications = {}

    if "gitea" in result:
        gitea_data = result["gitea"]
        org = gitea_data.get("org", "agentic-hr")
        team = gitea_data.get("team", "engineering")
        username = gitea_data.get("username", "")
        verified = gitea.verify_acess(org, team, username)
        verifications["gitea"] = verified
        log.info("Gitea verification | username=%s | verified=%s", username, verified)

    if "mattermost" in result:
        mm_data = result["mattermost"]
        team = mm_data.get("team", "engineering")
        verified = mattermost.verify_access(team, email)
        verifications["mattermost"] = verified
        log.info("Mattermost verification | user=%s | verified=%s", email, verified)

    if not verifications:
        log.debug("No systems to verify")

    state["fulfillment_result"] = {**result, "verifications": verifications}
    return state
