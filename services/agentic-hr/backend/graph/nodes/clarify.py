"""
clarify node — asks one targeted clarification question when intent confidence is low.
"""
from logger import get_logger
from models.state import AgentState
from llm.client import fast_chat

log = get_logger(__name__)

_SYSTEM = (
    "You are an HR assistant. The employee's request was unclear. "
    "Ask ONE short, specific clarification question to understand what they need. "
    "Do not explain yourself or ask multiple questions."
)


def clarify(state: AgentState) -> AgentState:
    """Generate a targeted clarification question for ambiguous messages.

    Triggered when classify_intent sets needs_clarification=True (confidence
    below 0.6 and intent unsupported). Uses the fast LLM to ask the employee
    a single focused question.

    Args:
        state: AgentState with the original employee message.

    Returns:
        Updated AgentState with response set to the clarification question and
        status set to "needs_clarification".
    """
    log.info("Requesting clarification | session=%s", state.get("session_id"))
    prompt = f"Employee message: {state['message']}\n\nAsk one clarification question."
    state["response"] = fast_chat(prompt, system=_SYSTEM)
    state["status"] = "needs_clarification"
    log.debug("Clarification question generated")
    return state
