"""
compose_response node — formats the final user-facing response.
"""
from datetime import date

from logger import get_logger
from models.state import AgentState
from llm.client import fast_chat
from llm.prompts import COMPOSE_PROMPT

log = get_logger(__name__)


def compose_response_node(state: AgentState) -> AgentState:
    """Format the final user-facing Markdown response based on intent and worker output.

    Handles each intent path separately:
    - leave_balance: Renders a bullet list from leave_data.balances.
    - leave_apply: Formats the success/failure result of the application.
    - access_request_status: Renders a status table from access_requests_data.
    - software_provision: Handles pending/fulfilled/ineligible states.
    - policy_query: Passes through the LLM-generated answer unchanged.
    - unsupported: Returns the standard out-of-scope message.

    For other intents with a response already set, passes the text through
    the fast LLM compose prompt for polish.

    Args:
        state: AgentState after all worker nodes have run.

    Returns:
        Updated AgentState with response set to the final Markdown string.
    """
    intent = state.get("intent")
    log.info("Composing response | intent=%s | session=%s", intent, state.get("session_id"))

    # policy_query: policy_grade_answer already returns polished Markdown + citations
    _no_llm_reformat = ("leave_balance", "leave_apply", "access_request_status", "policy_query")
    if state.get("response") and intent not in _no_llm_reformat:
        raw = state["response"]
        state["response"] = fast_chat(COMPOSE_PROMPT.format(answer=raw))
        log.debug("Response composed via LLM")
        return state

    # --- Leave balance ---
    if intent == "leave_balance":
        leave_data = state.get("leave_data")
        if not leave_data or not leave_data.get("balances"):
            log.warning("No leave balance data to compose")
            state["response"] = "I couldn't find your leave balance. Please contact HR."
            return state

        balances = leave_data["balances"]
        today = date.today().isoformat()
        lines = [f"Here is your leave balance as of {today}:\n"]
        for b in balances:
            lt = b.get("leave_type", "").replace("_", " ").title()
            bal = b.get("balance_hours", 0)
            accrued = b.get("accrued_ytd_hours", 0)
            used = b.get("used_ytd_hours", 0)
            lines.append(
                f"- **{lt}**: {bal:.1f} hrs available "
                f"(accrued {accrued:.1f} YTD, used {used:.1f} YTD)"
            )
        state["response"] = "\n".join(lines)
        log.debug("Leave balance response composed | %d leave type(s)", len(balances))
        return state

    # --- Leave application ---
    if intent == "leave_apply":
        status = state.get("leave_apply_status")
        if status == "applied":
            leave_type = state.get("leave_apply_type", "").replace("_", " ").title()
            hours = state.get("leave_apply_hours", 0)
            duration = state.get("leave_apply_duration", 0)
            unit = state.get("leave_apply_unit", "days")
            new_bal = state.get("leave_apply_new_balance", 0)
            state["response"] = (
                f"Your **{leave_type}** leave application has been submitted successfully!\n\n"
                f"- **Duration**: {duration} {unit} ({hours:.1f} hours)\n"
                f"- **Remaining balance**: {new_bal:.1f} hours\n\n"
                "Your leave has been recorded."
            )
            log.info("Leave apply response: applied | type=%s | hours=%.1f", leave_type, hours)
        elif status in ("insufficient_balance", "missing_info", "update_failed", "no_balance_record"):
            pass  # Response already set in the relevant node
        else:
            state["response"] = "Something went wrong processing your leave application."
            log.warning("Leave apply — unexpected status: %s", status)
        return state

    # --- Access request status ---
    if intent == "access_request_status":
        requests_data = state.get("access_requests_data")
        if not requests_data:
            state["response"] = "You don't have any access requests on record."
            log.info("Access request status — no records found")
        else:
            lines = ["Here are your access request(s):\n"]
            for req in requests_data:
                rid = req.get("request_id", "N/A")
                pkg_name = req.get("package_name") or req.get("package_id", "Unknown")
                target_sys = req.get("target_system", "")
                status = req.get("status", "unknown")
                created = req.get("created_ts", "")
                decided = req.get("decided_ts", "")

                status_label = {
                    "pending": "Pending",
                    "pending_approval": "Pending Approval",
                    "approved": "Approved",
                    "denied": "Denied",
                    "fulfilled": "Fulfilled",
                }.get(status, status.replace("_", " ").title())

                sys_label = f" ({target_sys})" if target_sys else ""
                line = (
                    f"- **{rid}** — {pkg_name}{sys_label}\n"
                    f"  Status: **{status_label}**\n"
                    f"  Submitted: {str(created)[:10] if created else 'N/A'}"
                )
                if decided:
                    line += f" | Decided: {str(decided)[:10]}"
                lines.append(line)

            state["response"] = "\n".join(lines)
            log.info("Access request status response | records=%d", len(requests_data))
        return state

    # --- Provisioning pending ---
    if intent == "software_provision" and state.get("approval_status") == "pending_approval":
        pkgs = state.get("matched_packages") or []
        pkg_str = ", ".join(pkgs) if pkgs else "the requested system(s)"
        state["response"] = (
            f"Your access request for **{pkg_str}** has been submitted "
            f"(Request ID: `{state.get('request_id')}`). "
            "It is now awaiting manager approval. You'll be notified once it's processed."
        )
        log.info("Provisioning response: pending_approval | request_id=%s", state.get("request_id"))
        return state

    # --- Provisioning fulfilled ---
    if intent == "software_provision" and state.get("approval_status") == "fulfilled":
        result = state.get("fulfillment_result") or {}
        parts = []
        if "gitea" in result:
            g = result["gitea"]
            parts.append(f"Gitea: added to **{g.get('org')}/{g.get('team')}** team ✓")
        if "mattermost" in result:
            m = result["mattermost"]
            chs = ", ".join(f"`#{c}`" for c in m.get("channels_joined", []))
            parts.append(f"Mattermost: joined {chs} ✓")
        state["response"] = ("Provisioning complete!\n" + "\n".join(parts)) if parts else "Access provisioning completed."
        log.info("Provisioning response: fulfilled")
        return state

    # --- Ineligible ---
    if intent == "software_provision" and state.get("eligible") is False:
        reason = state.get("eligibility_reason", "You are not eligible for this access.")
        state["response"] = f"Access request denied: {reason}"
        log.info("Provisioning response: ineligible | reason=%r", reason)
        return state

    # --- Unsupported ---
    if intent == "unsupported":
        state["response"] = (
            "I can help with leave balance queries, HR policy questions, "
            "and software access provisioning. "
            "This request falls outside those areas — please contact HR directly."
        )
        log.info("Unsupported intent — fallback response")
        return state

    if not state.get("response"):
        log.warning("No response set — using fallback")
        state["response"] = "I'm sorry, I wasn't able to process your request."

    return state
