"""In-memory call session tracking for live voice capture (browser mic
or Twilio phone call). Same pattern as ../review_store.py: a plain
module-level dict, safe for this single-instance demo service, not
meant to survive a process restart or scale across instances.

This module is deliberately dumb -- it holds transcript/caller/status
state for the UI to render, and nothing here ever touches triage,
ranking, or dispatch. Those only happen when a human explicitly submits
the accumulated transcript through the existing /dispatch/stream flow.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class CallSession:
    call_id: str
    source: str  # "browser" | "twilio"
    caller_number: str | None = None
    status: str = "connecting"  # "connecting" | "in_progress" | "ended"
    started_at: float = field(default_factory=time.monotonic)
    ended_at: float | None = None
    transcript: str = ""
    interim_text: str = ""

    @property
    def duration_s(self) -> float:
        end = self.ended_at if self.ended_at is not None else time.monotonic()
        return end - self.started_at


_sessions: dict[str, CallSession] = {}


def start(call_id: str, source: str, caller_number: str | None = None) -> CallSession:
    session = CallSession(call_id=call_id, source=source, caller_number=caller_number, status="in_progress")
    _sessions[call_id] = session
    return session


def get(call_id: str) -> CallSession | None:
    return _sessions.get(call_id)


def append_transcript(call_id: str, text: str, is_final: bool) -> CallSession | None:
    session = _sessions.get(call_id)
    if session is None:
        return None
    if is_final:
        session.transcript = f"{session.transcript} {text}".strip()
        session.interim_text = ""
    else:
        session.interim_text = text
    return session


def end(call_id: str) -> CallSession | None:
    session = _sessions.get(call_id)
    if session is None:
        return None
    session.status = "ended"
    session.ended_at = time.monotonic()
    return session
