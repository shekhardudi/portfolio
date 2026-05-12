"""
Guardrail policy evaluation and action determination.
"""

from enum import Enum
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from .detector import Detector, PiiDetection, PromptInjectionDetection
from .config import GuardrailConfig, PiiCategory, GuardrailMode, HIGH_RISK_CATEGORIES


class GuardrailAction(str, Enum):
    """Actions taken based on guardrail evaluation."""
    ALLOW = "allow"  # No PII/injection detected, proceed
    WARN = "warn"  # PII/injection detected, log warning, proceed (warn mode only)
    BLOCK = "block"  # PII/injection detected, block request/response
    REDACT = "redact"  # Redact PII from output before returning to user


@dataclass
class GuardrailDecision:
    """Result of guardrail policy evaluation."""
    action: GuardrailAction
    reason: str  # Human-readable reason for decision
    pii_detections: List[PiiDetection] = None
    injection_detections: List[PromptInjectionDetection] = None
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.pii_detections is None:
            self.pii_detections = []
        if self.injection_detections is None:
            self.injection_detections = []
        if self.metadata is None:
            self.metadata = {}


class GuardrailPolicy:
    """
    Evaluates guardrail rules and determines appropriate action based on
    config mode and detection results.
    """
    
    def __init__(self, config: GuardrailConfig):
        self.config = config
        self.detector = Detector(config)
    
    def evaluate_inbound(self, text: str) -> GuardrailDecision:
        """
        Evaluate guardrails for inbound user request.
        
        Args:
            text: User message/query
        
        Returns:
            GuardrailDecision with action and metadata
        """
        pii_detections = self.detector.detect_pii(text)
        injection_detections = self.detector.detect_prompt_injection(text)
        
        # Check for any detections
        if not pii_detections and not injection_detections:
            return GuardrailDecision(
                action=GuardrailAction.ALLOW,
                reason="No PII or prompt-injection detected",
            )
        
        # Determine action based on mode and severity
        decision = self._determine_action(pii_detections, injection_detections)
        decision.pii_detections = pii_detections
        decision.injection_detections = injection_detections
        decision.metadata = {
            "pii_count": len(pii_detections),
            "injection_count": len(injection_detections),
            "pii_categories": [d.category.value for d in pii_detections],
            "injection_patterns": [d.pattern for d in injection_detections],
        }
        
        return decision
    
    def evaluate_llm_prompt(self, text: str) -> GuardrailDecision:
        """
        Evaluate guardrails for LLM prompt (after enrichment).
        Similar to inbound but used at LLM invocation point.
        
        Args:
            text: Constructed prompt for LLM
        
        Returns:
            GuardrailDecision
        """
        # For now, same logic as inbound; can be specialized later
        return self.evaluate_inbound(text)
    
    def evaluate_llm_response(self, text: str) -> GuardrailDecision:
        """
        Evaluate guardrails for LLM response (before returning to user).
        
        Args:
            text: Generated response from LLM
        
        Returns:
            GuardrailDecision
        """
        # For responses, we typically want to redact any PII that might be in output
        pii_detections = self.detector.detect_pii(text)
        injection_detections = self.detector.detect_prompt_injection(text)
        
        if not pii_detections and not injection_detections:
            return GuardrailDecision(
                action=GuardrailAction.ALLOW,
                reason="No PII or injection in response",
            )
        
        # For response, always recommend redaction if PII detected
        if pii_detections:
            return GuardrailDecision(
                action=GuardrailAction.REDACT,
                reason=f"Redacting {len(pii_detections)} PII detection(s) from response",
                pii_detections=pii_detections,
                injection_detections=injection_detections,
                metadata={
                    "pii_count": len(pii_detections),
                    "injection_count": len(injection_detections),
                    "pii_categories": [d.category.value for d in pii_detections],
                },
            )
        
        return GuardrailDecision(
            action=GuardrailAction.ALLOW,
            reason="No PII in response, injection detection only",
            injection_detections=injection_detections,
        )
    
    def _determine_action(
        self,
        pii_detections: List[PiiDetection],
        injection_detections: List[PromptInjectionDetection],
    ) -> GuardrailDecision:
        """
        Determine action based on detections and config mode.
        
        Args:
            pii_detections: List of detected PII
            injection_detections: List of detected prompt injections
        
        Returns:
            GuardrailDecision
        """
        has_high_risk_pii = any(
            self.config.is_high_risk(d.category) for d in pii_detections
        )
        has_injection = len(injection_detections) > 0
        
        if self.config.mode == GuardrailMode.WARN:
            # Warn mode: log but never block
            reason = self._build_warning_reason(pii_detections, injection_detections)
            return GuardrailDecision(
                action=GuardrailAction.WARN,
                reason=reason,
            )
        
        elif self.config.mode == GuardrailMode.BLOCK_HIGH_RISK:
            # Block only high-risk PII
            if has_high_risk_pii:
                reason = f"Blocking request with high-risk PII: {', '.join(set(d.category.value for d in pii_detections if self.config.is_high_risk(d.category)))}"
                return GuardrailDecision(
                    action=GuardrailAction.BLOCK,
                    reason=reason,
                )
            elif has_injection:
                reason = f"Blocking request with prompt-injection: {', '.join(set(d.pattern for d in injection_detections))}"
                return GuardrailDecision(
                    action=GuardrailAction.BLOCK,
                    reason=reason,
                )
            else:
                # Other PII detected but not high-risk; warn
                reason = self._build_warning_reason(pii_detections, injection_detections)
                return GuardrailDecision(
                    action=GuardrailAction.WARN,
                    reason=reason,
                )
        
        elif self.config.mode == GuardrailMode.STRICT:
            # Block all detections
            if pii_detections or injection_detections:
                categories = set(d.category.value for d in pii_detections)
                patterns = set(d.pattern for d in injection_detections)
                reason = f"Strict mode: blocking request with PII ({', '.join(categories)}) and/or injection ({', '.join(patterns)})"
                return GuardrailDecision(
                    action=GuardrailAction.BLOCK,
                    reason=reason,
                )
        
        # Fallback
        return GuardrailDecision(
            action=GuardrailAction.ALLOW,
            reason="No policy match; allowing request",
        )
    
    def _build_warning_reason(
        self,
        pii_detections: List[PiiDetection],
        injection_detections: List[PromptInjectionDetection],
    ) -> str:
        """Build a descriptive warning message."""
        parts = []
        
        if pii_detections:
            categories = set(d.category.value for d in pii_detections)
            parts.append(f"PII detected: {', '.join(sorted(categories))}")
        
        if injection_detections:
            patterns = set(d.pattern for d in injection_detections)
            parts.append(f"Prompt-injection patterns: {', '.join(sorted(patterns))}")
        
        return "; ".join(parts) if parts else "Guardrail warning triggered"
