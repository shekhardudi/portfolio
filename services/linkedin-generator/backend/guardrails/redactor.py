"""
PII redactor: mask detected sensitive data in text.
"""

from typing import List
from .detector import PiiDetection, Detector
from .config import GuardrailConfig, PiiCategory


class Redactor:
    """
    Redacts (masks) detected PII in text.
    """
    
    MASKING_TEMPLATES = {
        PiiCategory.EMAIL: "[EMAIL]",
        PiiCategory.PHONE: "[PHONE]",
        PiiCategory.SSN: "[SSN]",
        PiiCategory.CREDIT_CARD: "[CREDIT_CARD]",
        PiiCategory.BANK_ACCOUNT: "[BANK_ACCOUNT]",
        PiiCategory.DATE_OF_BIRTH: "[DOB]",
        PiiCategory.ADDRESS: "[ADDRESS]",
    }
    
    def __init__(self, config: GuardrailConfig):
        self.config = config
        self.detector = Detector(config)
    
    def redact(self, text: str) -> str:
        """
        Redact all detected PII in text by replacing with category-specific tokens.
        
        Args:
            text: Input text
        
        Returns:
            Text with detected PII replaced by masks
        """
        detections = self.detector.detect_pii(text)
        
        if not detections:
            return text
        
        # Sort detections by position (reverse) to avoid offset issues during replacement
        detections_sorted = sorted(detections, key=lambda d: d.position[0], reverse=True)
        
        result = text
        for detection in detections_sorted:
            mask = self.MASKING_TEMPLATES.get(detection.category, "[REDACTED]")
            start, end = detection.position
            result = result[:start] + mask + result[end:]
        
        return result
    
    def redact_selective(self, text: str, categories: List[PiiCategory]) -> str:
        """
        Redact only detections matching selected categories.
        
        Args:
            text: Input text
            categories: List of PiiCategory to redact
        
        Returns:
            Text with selected categories redacted
        """
        detections = self.detector.detect_pii(text)
        
        # Filter to only selected categories
        filtered = [d for d in detections if d.category in categories]
        
        if not filtered:
            return text
        
        # Sort detections by position (reverse)
        filtered_sorted = sorted(filtered, key=lambda d: d.position[0], reverse=True)
        
        result = text
        for detection in filtered_sorted:
            mask = self.MASKING_TEMPLATES.get(detection.category, "[REDACTED]")
            start, end = detection.position
            result = result[:start] + mask + result[end:]
        
        return result
    
    def redact_for_audit(self, text: str) -> str:
        """
        Redact all enabled PII categories for audit logging.
        Uses enabled_pii_categories from config.
        
        Args:
            text: Input text (e.g., user query or model response)
        
        Returns:
            Text with all enabled PII categories redacted
        """
        if not self.config.redact_audit_pii:
            return text
        
        return self.redact_selective(text, list(self.config.enabled_pii_categories))
