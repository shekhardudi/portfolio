import time

from config import settings
from logger import get_logger
from guardrails.policy import GuardrailPolicy, GuardrailAction
from guardrails.redactor import Redactor

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Provider-specific call functions
# ---------------------------------------------------------------------------

def _call_anthropic(prompt: str, system: str, model: str, max_tokens: int) -> str:
    """Call the Anthropic Messages API with lazy client initialisation.

    Reuses a module-level client instance across calls to avoid re-creating
    the authenticated session on every request.

    Args:
        prompt: The user message content.
        system: Optional system prompt string (omitted from request if empty).
        model: Anthropic model identifier (e.g. "claude-haiku-4-5").
        max_tokens: Maximum tokens to generate in the response.

    Returns:
        Tuple of (response_text, output_token_count).
    """
    import anthropic
    client = getattr(_call_anthropic, "_client", None)
    if client is None:
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=3)
        _call_anthropic._client = client
    messages = [{"role": "user", "content": prompt}]
    kwargs = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if system:
        kwargs["system"] = system
    response = client.messages.create(**kwargs)
    return response.content[0].text.strip(), response.usage.output_tokens


def _call_openai(prompt: str, system: str, model: str, max_tokens: int) -> str:
    """Call the OpenAI Chat Completions API with lazy client initialisation.

    Reuses a module-level client instance across calls. Prepends a system
    message only when a non-empty system string is provided.

    Args:
        prompt: The user message content.
        system: Optional system prompt string (omitted from messages if empty).
        model: OpenAI model identifier (e.g. "gpt-4o-mini").
        max_tokens: Maximum tokens to generate in the response.

    Returns:
        Tuple of (response_text, output_token_count).
    """
    import openai
    client = getattr(_call_openai, "_client", None)
    if client is None:
        client = openai.OpenAI(api_key=settings.openai_api_key)
        _call_openai._client = client
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    response = client.chat.completions.create(
        model=model, max_tokens=max_tokens, messages=messages,
    )
    choice = response.choices[0].message.content.strip()
    return choice, response.usage.completion_tokens


# ---------------------------------------------------------------------------
# Provider dispatch
# ---------------------------------------------------------------------------

_PROVIDERS = {"anthropic": _call_anthropic, "openai": _call_openai}

_provider = settings.llm_provider.lower()
if _provider not in _PROVIDERS:
    raise ValueError(
        f"Unsupported LLM_PROVIDER={settings.llm_provider!r}. "
        f"Choose from: {', '.join(_PROVIDERS)}"
    )
_call = _PROVIDERS[_provider]
log.info("LLM provider: %s", _provider)


# ---------------------------------------------------------------------------
# Guardrail helpers
# ---------------------------------------------------------------------------

def _sanitize_prompt(prompt: str) -> str:
    """Apply guardrail sanitization to prompt before LLM call."""
    guardrail_config = settings.get_guardrail_config()
    guardrail_policy = GuardrailPolicy(guardrail_config)
    
    decision = guardrail_policy.evaluate_llm_prompt(prompt)
    log.debug("LLM prompt guardrail | action=%s | pii_count=%d | injection_count=%d",
              decision.action.value,
              len(decision.pii_detections),
              len(decision.injection_detections))
    
    if decision.action == GuardrailAction.BLOCK:
        log.warning("LLM prompt blocked by guardrails | reason=%s", decision.reason)
        raise ValueError(f"Prompt rejected: {decision.reason}")
    
    # If PII detected in warn mode, still redact for the LLM call
    if decision.pii_detections:
        log.info("Redacting PII from LLM prompt")
        redactor = Redactor(guardrail_config)
        prompt = redactor.redact(prompt)
    
    return prompt


def _filter_response(response: str) -> str:
    """Apply guardrail filtering to LLM response before returning."""
    guardrail_config = settings.get_guardrail_config()
    guardrail_policy = GuardrailPolicy(guardrail_config)
    
    decision = guardrail_policy.evaluate_llm_response(response)
    log.debug("LLM response guardrail | action=%s | pii_count=%d",
              decision.action.value,
              len(decision.pii_detections))
    
    if decision.action == GuardrailAction.BLOCK:
        log.warning("LLM response blocked by guardrails | reason=%s", decision.reason)
        raise ValueError(f"Response rejected: {decision.reason}")
    
    # Redact PII from response if detected
    if decision.action == GuardrailAction.REDACT:
        log.info("Redacting PII from LLM response")
        redactor = Redactor(guardrail_config)
        response = redactor.redact(response)
    
    return response


# ---------------------------------------------------------------------------
# Public API (unchanged signatures)
# ---------------------------------------------------------------------------

def fast_chat(prompt: str, system: str = "") -> str:
    """Call the fast (Haiku / GPT-4o-mini) model. Use for routing, extraction, grading."""
    model = settings.llm_fast_model
    log.debug("LLM fast call | model=%s | prompt_len=%d", model, len(prompt))
    
    # Apply guardrail sanitization to prompt
    prompt = _sanitize_prompt(prompt)
    
    t0 = time.perf_counter()
    text, out_tokens = _call(prompt, system, model, 1024)
    elapsed = time.perf_counter() - t0
    
    # Apply guardrail filtering to response
    text = _filter_response(text)
    
    log.debug(
        "LLM fast done | model=%s | out_tokens=%d | elapsed=%.2fs",
        model, out_tokens, elapsed,
    )
    return text


def strong_chat(prompt: str, system: str = "") -> str:
    """Call the strong (Sonnet / GPT-4o) model. Use for grounded answer generation."""
    model = settings.llm_strong_model
    log.debug("LLM strong call | model=%s | prompt_len=%d", model, len(prompt))
    
    # Apply guardrail sanitization to prompt
    prompt = _sanitize_prompt(prompt)
    
    t0 = time.perf_counter()
    text, out_tokens = _call(prompt, system, model, 2048)
    elapsed = time.perf_counter() - t0
    
    # Apply guardrail filtering to response
    text = _filter_response(text)
    
    log.info(
        "LLM strong done | model=%s | out_tokens=%d | elapsed=%.2fs",
        model, out_tokens, elapsed,
    )
    return text
