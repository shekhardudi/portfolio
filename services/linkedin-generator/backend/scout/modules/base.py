"""Base types shared by all Pulse Scout module scanners."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from ..types import MemorySnapshot


ProgressFn = Callable[[dict[str, Any]], None]


@dataclass
class ScanResult:
    module_id: str
    module_label: str
    items: list[dict]
    error: str | None = None
    queries_used: list[str] = field(default_factory=list)


class BaseScanner(ABC):
    MODULE_ID: str
    MODULE_LABEL: str

    @abstractmethod
    def scan(self, days: int) -> ScanResult:
        """Run the scan for the given time window. Legacy entry point.

        Args:
            days: Number of days to look back. 0 means no filter.

        Returns:
            ScanResult with collected items or error message.
        """
        ...

    def gather(
        self,
        days: int,
        snapshot: Optional[MemorySnapshot] = None,
        progress: Optional[ProgressFn] = None,
    ) -> ScanResult:
        """Memory- + progress-aware scan.

        Default implementation falls back to ``scan(days)`` so legacy
        scanners keep working unchanged. Modules that want rotation /
        cache-hit reporting / URL diff override this method.
        """
        return self.scan(days)
