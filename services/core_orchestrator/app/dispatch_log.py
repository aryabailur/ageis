"""Fire-and-forget dispatch call logger.

Writes a full DispatchState snapshot to the ``dispatch_logs`` Supabase
table after every completed dispatch (any terminal status: DISPATCHED,
COMPLETED, FAILED, AWAITING_REVIEW).

Design notes
------------
- Uses ``call_with_fallback`` from ``aegis_contracts.fallback`` so a DB
  write failure is never silently swallowed: the helper already emits a
  ``logger.warning`` before the fallback runs, and the fallback itself
  logs an additional structured warning via the module logger.  Two lines
  of visibility, zero silent failures.
- The Supabase Python client is synchronous; the insert is wrapped in
  ``asyncio.to_thread`` so the event loop is never blocked.
- Callers should fire-and-forget with ``asyncio.create_task(log_dispatch(state))``
  so the HTTP response is never held waiting for the DB write.

PII note
--------
``state_snapshot`` contains ``raw_transcript``, ``caller_lat``,
``caller_lng``, and any caller phone number captured during a voice
session.  The ``/api/logs*`` endpoints that read this table are currently
unauthenticated, consistent with the rest of the system's trust model
(private network / trusted operator assumed).  Do not expose publicly
before adding auth.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from aegis_contracts import DispatchState
from aegis_contracts.fallback import call_with_fallback
from aegis_contracts.supabase_client import get_client

logger = logging.getLogger("aegis.dispatch_log")


def _insert(state: DispatchState) -> None:
    """Synchronous Supabase insert — always call via asyncio.to_thread."""
    row: dict[str, Any] = {
        "call_id": state.call_id,
        "status": state.status.value if hasattr(state.status, "value") else str(state.status),
        "priority": (
            state.triage.priority.value
            if state.triage and hasattr(state.triage.priority, "value")
            else (state.triage.priority if state.triage else None)
        ),
        "caller_lat": state.caller_lat,
        "caller_lng": state.caller_lng,
        "state_snapshot": state.model_dump(mode="json"),
    }
    get_client().table("dispatch_logs").insert(row).execute()


async def log_dispatch(state: DispatchState) -> None:
    """Write *state* to ``dispatch_logs``.

    On any DB failure the ``aegis.fallback`` logger already emits a
    WARNING (inside ``call_with_fallback``).  The fallback callable here
    adds a second, structured WARNING at the ``aegis.dispatch_log`` logger
    so the failed call_id is visible in context without having to grep the
    generic fallback line.

    This function never raises; a logging failure must never affect the
    caller's response.
    """
    await call_with_fallback(
        lambda: asyncio.to_thread(_insert, state),
        lambda: logger.warning(
            "dispatch_log DB write skipped for call_id=%s (DB unreachable or misconfigured)",
            state.call_id,
        ),
        primary_label="supabase:dispatch_logs",
        fallback_label="dispatch_log_skipped",
    )
