"""Holds calls paused in AWAITING_REVIEW between the SSE stream that
paused them and the human's /dispatch/{call_id}/review decision.

In-process and non-persistent by design: this is a single-instance
service (see reservation_store.py's comment on why cross-instance safety
is left to Postgres uniqueness, not in-process locking), so a plain dict
is the right amount of infrastructure here. A process restart loses any
in-flight paused calls, which is an acceptable tradeoff for this demo
scale rather than pulling in a real checkpoint store.
"""

from __future__ import annotations

from aegis_contracts import DispatchState

_paused: dict[str, DispatchState] = {}


def save(state: DispatchState) -> None:
    _paused[state.call_id] = state


def peek(call_id: str) -> DispatchState | None:
    return _paused.get(call_id)


def pop(call_id: str) -> DispatchState | None:
    return _paused.pop(call_id, None)
