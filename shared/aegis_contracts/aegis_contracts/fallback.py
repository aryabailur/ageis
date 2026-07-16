"""Design Law 4: degrade gracefully, visibly. One helper, used by every
service-to-service call in the system: try the primary call with a short
timeout, and on ANY failure (timeout, connection error, bad response) fall
back immediately — never a retry loop — to a labeled local fallback.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, TypeVar

logger = logging.getLogger("aegis.fallback")

T = TypeVar("T")

DEFAULT_TIMEOUT_S = 1.8


@dataclass
class FallbackResult(Generic[T]):
    value: T
    data_source: str
    used_fallback: bool


async def call_with_fallback(
    primary: Callable[[], Awaitable[T]],
    fallback: Callable[[], T] | Callable[[], Awaitable[T]],
    *,
    primary_label: str,
    fallback_label: str,
    timeout_s: float = DEFAULT_TIMEOUT_S,
) -> FallbackResult[T]:
    try:
        value = await asyncio.wait_for(primary(), timeout=timeout_s)
        return FallbackResult(value=value, data_source=primary_label, used_fallback=False)
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as exc:  # noqa: BLE001 - any failure degrades, by design
        # BaseException, not Exception: under real concurrent load the MCP
        # transport's internal task groups can surface a (Base)ExceptionGroup
        # wrapping a cancellation, which `except Exception` does not catch --
        # and an uncaught failure here defeats the entire point of this
        # helper. See services/core_orchestrator/tests/test_run_batch.py.
        logger.warning(
            "primary call '%s' failed (%s); falling back to '%s'",
            primary_label,
            exc,
            fallback_label,
        )
        result = fallback()
        if inspect.isawaitable(result):
            result = await result
        return FallbackResult(value=result, data_source=fallback_label, used_fallback=True)
