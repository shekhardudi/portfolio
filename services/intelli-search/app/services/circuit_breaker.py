"""
Circuit Breaker Service.

Implements the standard three-state circuit breaker pattern to prevent
cascading failures when an external dependency (OpenAI, Tavily, OpenSearch)
is degraded or unavailable.

States:
  CLOSED    — normal operation; calls pass through and failures are counted.
  OPEN      — dependency is failing; calls are rejected immediately without
              attempting the operation.
  HALF_OPEN — recovery probe; one call is allowed through to test whether
              the dependency has recovered.

Usage::

    from app.services.circuit_breaker import CircuitBreaker, CircuitOpenError

    _tavily_cb = CircuitBreaker("tavily", failure_threshold=5, timeout=30)

    try:
        result = _tavily_cb.call(requests.post, url, json=payload, timeout=8)
    except CircuitOpenError:
        logger.warning("tavily_circuit_open")
        return []
"""
import time
import threading
from enum import Enum
from typing import Any, Callable

import structlog

logger = structlog.get_logger(__name__)


class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitOpenError(Exception):
    """Raised when a call is attempted while the circuit is OPEN."""


class CircuitBreaker:
    """
    Thread-safe circuit breaker.

    Args:
        name: Human-readable name used in log events (e.g. ``"tavily"``).
        failure_threshold: Consecutive failures required to open the circuit.
        timeout: Seconds before an OPEN circuit transitions to HALF_OPEN to
                 probe for recovery.
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        timeout: float = 60.0,
    ) -> None:
        self.name = name
        self._failure_threshold = failure_threshold
        self._timeout = timeout
        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._opened_at: float | None = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def call(self, fn: Callable, *args: Any, **kwargs: Any) -> Any:
        """
        Execute *fn* if the circuit permits it, otherwise raise
        :exc:`CircuitOpenError`.

        On success the failure counter is reset (CLOSED) or the circuit is
        closed (HALF_OPEN). On failure the counter is incremented and the
        circuit is opened once the threshold is reached.
        """
        with self._lock:
            state = self._check_state()

        if state == CircuitState.OPEN:
            raise CircuitOpenError(
                f"Circuit '{self.name}' is OPEN — dependency unavailable."
            )

        try:
            result = fn(*args, **kwargs)
            self._on_success()
            return result
        except Exception:
            self._on_failure()
            raise

    @property
    def state(self) -> CircuitState:
        with self._lock:
            return self._check_state()

    # ------------------------------------------------------------------
    # Internal state machine (must be called with self._lock held)
    # ------------------------------------------------------------------

    def _check_state(self) -> CircuitState:
        """Transition OPEN → HALF_OPEN when the recovery timeout has elapsed."""
        if (
            self._state == CircuitState.OPEN
            and self._opened_at is not None
            and (time.monotonic() - self._opened_at) >= self._timeout
        ):
            self._state = CircuitState.HALF_OPEN
            logger.warning(
                "circuit_breaker_half_open",
                circuit=self.name,
                timeout_s=self._timeout,
            )
        return self._state

    def _on_success(self) -> None:
        with self._lock:
            if self._state == CircuitState.HALF_OPEN:
                self._state = CircuitState.CLOSED
                self._failure_count = 0
                self._opened_at = None
                logger.info(
                    "circuit_breaker_closed",
                    circuit=self.name,
                    reason="probe_succeeded",
                )
            elif self._state == CircuitState.CLOSED:
                self._failure_count = 0

    def _on_failure(self) -> None:
        with self._lock:
            self._failure_count += 1
            if self._state == CircuitState.HALF_OPEN:
                # Probe failed — reopen immediately.
                self._state = CircuitState.OPEN
                self._opened_at = time.monotonic()
                logger.warning(
                    "circuit_breaker_opened",
                    circuit=self.name,
                    reason="probe_failed",
                    failure_count=self._failure_count,
                )
            elif (
                self._state == CircuitState.CLOSED
                and self._failure_count >= self._failure_threshold
            ):
                self._state = CircuitState.OPEN
                self._opened_at = time.monotonic()
                logger.warning(
                    "circuit_breaker_opened",
                    circuit=self.name,
                    reason="threshold_exceeded",
                    failure_count=self._failure_count,
                    threshold=self._failure_threshold,
                )
