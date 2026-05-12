"""
PII and prompt-injection detector using regex and heuristic patterns.
"""

import re
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from .config import PiiCategory, GuardrailConfig


@dataclass
class PiiDetection:
    """Result of PII detection."""
    category: PiiCategory
    match: str  # The matched text (may be masked)
    position: tuple  # (start, end) character positions in original text
    confidence: float = 1.0  # 0.0-1.0 confidence score


@dataclass
class PromptInjectionDetection:
    """Result of prompt-injection detection."""
    pattern: str  # Name of detected pattern
    match: str  # The matched text
    position: tuple  # (start, end) character positions
    confidence: float = 1.0  # 0.0-1.0 confidence score


class Detector:
    """
    Detects PII and prompt-injection attempts in text using regex and heuristics.
    """
    
    def __init__(self, config: GuardrailConfig):
        self.config = config
        self._compile_patterns()
    
    def _compile_patterns(self) -> None:
        """Compile all regex patterns."""
        self.patterns: Dict[PiiCategory, re.Pattern] = {}
        
        # Email: basic pattern
        if self.config.is_category_enabled(PiiCategory.EMAIL):
            self.patterns[PiiCategory.EMAIL] = re.compile(
                r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
            )
        
        # Phone: US/intl patterns
        if self.config.is_category_enabled(PiiCategory.PHONE):
            self.patterns[PiiCategory.PHONE] = re.compile(
                r'(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b'
            )
        
        # SSN: XXX-XX-XXXX or similar
        if self.config.is_category_enabled(PiiCategory.SSN):
            self.patterns[PiiCategory.SSN] = re.compile(
                r'\b(?:\d{3}[-]?\d{2}[-]?\d{4})\b'
            )
        
        # Credit card: 13-19 digit card number pattern
        if self.config.is_category_enabled(PiiCategory.CREDIT_CARD):
            self.patterns[PiiCategory.CREDIT_CARD] = re.compile(
                r'\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{13,19}\b'
            )
        
        # Bank account: 8-17 digit pattern (US standard)
        if self.config.is_category_enabled(PiiCategory.BANK_ACCOUNT):
            self.patterns[PiiCategory.BANK_ACCOUNT] = re.compile(
                r'\b\d{8,17}\b'
            )
        
        # Date of birth: MM/DD/YYYY, DD-MM-YYYY, etc.
        if self.config.is_category_enabled(PiiCategory.DATE_OF_BIRTH):
            self.patterns[PiiCategory.DATE_OF_BIRTH] = re.compile(
                r'\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:19|20)?\d{2}\b'
            )
        
        # Address: street patterns with numbers, city, state, zip
        if self.config.is_category_enabled(PiiCategory.ADDRESS):
            self.patterns[PiiCategory.ADDRESS] = re.compile(
                r'\b\d+\s+(?:North|South|East|West|N|S|E|W)?\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Court|Ct|Circle|Cir|Lane|Ln)\b',
                re.IGNORECASE
            )
    
    def detect_pii(self, text: str) -> List[PiiDetection]:
        """
        Detect all PII in text.
        
        Args:
            text: Input text to scan
        
        Returns:
            List of PiiDetection objects
        """
        detections = []
        for category, pattern in self.patterns.items():
            for match in pattern.finditer(text):
                detections.append(
                    PiiDetection(
                        category=category,
                        match=match.group(),
                        position=match.span(),
                    )
                )
        return detections
    
    def detect_prompt_injection(self, text: str) -> List[PromptInjectionDetection]:
        """
        Detect prompt-injection attempts using heuristic patterns.
        
        Args:
            text: Input text to scan
        
        Returns:
            List of PromptInjectionDetection objects
        """
        if not self.config.detect_prompt_injection:
            return []
        
        detections = []
        
        # Pattern 1: "ignore previous instructions"
        ignore_pattern = re.compile(
            r'(ignore|disregard|forget|bypass|override)\s+(previous|prior|above|earlier|my previous)\s+(instruction|prompt|system|request)',
            re.IGNORECASE
        )
        for match in ignore_pattern.finditer(text):
            detections.append(
                PromptInjectionDetection(
                    pattern="ignore_instructions",
                    match=match.group(),
                    position=match.span(),
                    confidence=0.9,
                )
            )
        
        # Pattern 2: "act as" or "pretend to be"
        roleplay_pattern = re.compile(
            r'(act\s+as|pretend\s+to\s+be|roleplay|you\s+are\s+now|switch\s+to|become)\s+a\s+',
            re.IGNORECASE
        )
        for match in roleplay_pattern.finditer(text):
            detections.append(
                PromptInjectionDetection(
                    pattern="roleplay_injection",
                    match=match.group(),
                    position=match.span(),
                    confidence=0.7,
                )
            )
        
        # Pattern 3: "do not", "never", or negative instruction modifiers
        negation_pattern = re.compile(
            r'(do\s+not|never|don\'t|shouldn\'t|can\'t|won\'t)\s+(answer|respond|tell|give|provide|use|say|mention)',
            re.IGNORECASE
        )
        for match in negation_pattern.finditer(text):
            detections.append(
                PromptInjectionDetection(
                    pattern="negation_directive",
                    match=match.group(),
                    position=match.span(),
                    confidence=0.6,
                )
            )
        
        # Pattern 4: SQL injection indicators
        sql_pattern = re.compile(
            r'(DROP|DELETE|INSERT|UPDATE|SELECT)\s+(TABLE|FROM|INTO|VALUES|WHERE)',
            re.IGNORECASE
        )
        for match in sql_pattern.finditer(text):
            detections.append(
                PromptInjectionDetection(
                    pattern="sql_injection",
                    match=match.group(),
                    position=match.span(),
                    confidence=0.95,
                )
            )
        
        return detections
    
    def has_pii(self, text: str) -> bool:
        """Quick check for presence of any detected PII."""
        return len(self.detect_pii(text)) > 0
    
    def has_prompt_injection(self, text: str) -> bool:
        """Quick check for presence of any prompt-injection patterns."""
        return len(self.detect_prompt_injection(text)) > 0
    
    def summarize_detections(self, text: str) -> Dict[str, Any]:
        """
        Generate a summary of all detections in text.
        
        Returns:
            Dict with keys: pii_count, pii_categories, injection_count, injection_patterns
        """
        pii = self.detect_pii(text)
        injections = self.detect_prompt_injection(text)
        
        pii_categories = {}
        for detection in pii:
            category = detection.category.value
            pii_categories[category] = pii_categories.get(category, 0) + 1
        
        injection_patterns = {}
        for detection in injections:
            pattern = detection.pattern
            injection_patterns[pattern] = injection_patterns.get(pattern, 0) + 1
        
        return {
            "pii_count": len(pii),
            "pii_categories": pii_categories,
            "injection_count": len(injections),
            "injection_patterns": injection_patterns,
        }
