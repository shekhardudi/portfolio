"""Query Postgres for the employee's access request status."""

from logger import get_logger
from db.hr import get_access_requests_by_employee
from models.state import AgentState

log = get_logger(__name__)


# Map common user-facing names to actual target_system values in the DB
_SYSTEM_ALIASES: dict[str, str] = {
    "gitea": "gitea",
    "github": "gitea",
    "git": "gitea",
    "repo": "gitea",
    "repository": "gitea",
    "mattermost": "mattermost",
    "slack": "mattermost",
    "chat": "mattermost",
    "messaging": "mattermost",
}


def _resolve_target_systems(entities: dict, message: str) -> list[str] | None:
    """Extract normalised target_system values from entities and message keywords.

    Maps user-facing system names (e.g. "github", "slack") to the canonical
    target_system values stored in the database (e.g. "gitea", "mattermost").
    Scans both the entities.systems list and the raw message text.

    Args:
        entities: Entities dict extracted by classify_intent.
        message: The original employee message for keyword scanning.

    Returns:
        List of canonical target_system strings, or None if no systems matched.
    """
    systems: set[str] = set()
    for s in (entities.get("systems") or []):
        mapped = _SYSTEM_ALIASES.get(s.lower())
        if mapped:
            systems.add(mapped)
    # Also scan the raw message for keywords
    msg_lower = message.lower()
    for keyword, target in _SYSTEM_ALIASES.items():
        if keyword in msg_lower:
            systems.add(target)
    return list(systems) if systems else None


def access_request_status_node(state: AgentState) -> AgentState:
    """Fetch the employee's access request history from PostgreSQL.

    Resolves any system name aliases in entities and message, then queries
    access_requests joined with access_packages. Results are stored in
    access_requests_data for compose_response to format.

    Args:
        state: AgentState with employee_id, entities, and message.

    Returns:
        Updated AgentState with access_requests_data list. Sets a fallback
        response message when employee_id is missing.
    """
    employee_id = state.get("employee_id")

    if not employee_id:
        log.warning("No employee_id — cannot fetch access requests | email=%s", state.get("employee_email"))
        state["access_requests_data"] = None
        state["response"] = "I couldn't find your employee record. Please contact HR."
        return state

    entities = state.get("entities") or {}
    request_id = entities.get("request_id")
    target_systems = _resolve_target_systems(entities, state["message"])

    log.info("Access request status | employee_id=%s | request_id=%s | systems=%s", employee_id, request_id, target_systems)
    requests = get_access_requests_by_employee(
        employee_id=employee_id,
        request_id=request_id,
        target_systems=target_systems,
    )
    state["access_requests_data"] = requests
    log.info("Access requests fetched | employee_id=%s | count=%d", employee_id, len(requests))
    return state
