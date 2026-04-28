"""
provision_map node — maps natural language requests to known access packages.
"""
from logger import get_logger
from models.state import AgentState
from db.hr import list_access_packages

log = get_logger(__name__)

_KEYWORD_MAP = {
    ("gitea", "github", "git", "code", "repo", "repository"): "PKG-GH-ENG-STD",
    ("mattermost", "slack", "chat", "messaging", "channel"): "PKG-SL-ENG-STD",
}


def provision_map_node(state: AgentState) -> AgentState:
    """Map natural language software requests to known access package IDs.

    Uses a keyword map to match system names from entities and the raw message
    against known package keywords (e.g. "gitea", "github" → PKG-GH-ENG-STD).
    Falls back to loading all packages from the database when no keywords match,
    allowing the pipeline to continue even for unknown system names.

    Args:
        state: AgentState with entities.systems list and the original message.

    Returns:
        Updated AgentState with matched_packages list of package_id strings.
    """
    entities = state.get("entities") or {}
    systems = [s.lower() for s in (entities.get("systems") or [])]
    message_lower = state["message"].lower()
    log.info("Mapping request to access packages | systems=%s | message=%r", systems, state["message"][:60])

    matched_packages = []
    for keywords, pkg_id in _KEYWORD_MAP.items():
        if any(kw in systems or kw in message_lower for kw in keywords):
            matched_packages.append(pkg_id)

    if not matched_packages:
        log.debug("No keyword match — loading all packages from DB")
        try:
            pkgs = list_access_packages()
            matched_packages = [p["package_id"] for p in pkgs]
        except Exception as e:
            log.error("Failed to load access packages: %s", e)
            matched_packages = []

    log.info("Matched packages: %s", matched_packages)
    state["matched_packages"] = matched_packages
    return state
