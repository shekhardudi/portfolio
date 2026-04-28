"""
policy_expand node — expands winning child chunks to their parent sections
for broader context.
"""
from logger import get_logger
from models.state import AgentState
from db.rag import get_parent_section

log = get_logger(__name__)


def policy_expand_node(state: AgentState) -> AgentState:
    """Expand retrieved child chunks to their parent sections for broader context.

    Collects unique parent_ids from the retrieved chunks and fetches the full
    parent section (heading, content, summary, document filename) for each.
    Parent sections are passed to the grading node to provide richer evidence.

    Args:
        state: AgentState with retrieved_chunks populated by policy_retrieve_node.

    Returns:
        Updated AgentState with parent_sections list loaded from the database.
    """
    chunks = state.get("retrieved_chunks") or []
    parent_ids = list({c["parent_id"] for c in chunks})
    log.info("Expanding %d chunk(s) to %d unique parent section(s)", len(chunks), len(parent_ids))

    parent_sections = []
    for pid in parent_ids:
        section = get_parent_section(pid)
        if section:
            parent_sections.append(section)
            log.debug("Loaded parent section | id=%s | heading=%r", pid, section.get("heading", "")[:60])

    log.info("Parent sections loaded: %d", len(parent_sections))
    state["parent_sections"] = parent_sections
    return state
