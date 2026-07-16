"""Pure in-memory session tracking, no network -- covers the same
call-lifecycle bookkeeping test_prearrival_guidance.py covers for
protocol lookups: every branch, deterministic.
"""

from __future__ import annotations

from app.voice import session


def test_start_creates_an_in_progress_session():
    s = session.start("call-v1", source="browser", caller_number="+15551234567")
    assert s.call_id == "call-v1"
    assert s.source == "browser"
    assert s.caller_number == "+15551234567"
    assert s.status == "in_progress"
    assert s.transcript == ""
    assert session.get("call-v1") is s


def test_append_transcript_final_appends_and_clears_interim():
    session.start("call-v2", source="browser")
    session.append_transcript("call-v2", "hello", is_final=False)
    s = session.get("call-v2")
    assert s.interim_text == "hello"
    assert s.transcript == ""

    session.append_transcript("call-v2", "hello world", is_final=True)
    s = session.get("call-v2")
    assert s.transcript == "hello world"
    assert s.interim_text == ""


def test_append_transcript_accumulates_across_multiple_final_chunks():
    session.start("call-v3", source="twilio", caller_number="+15559876543")
    session.append_transcript("call-v3", "chest pain", is_final=True)
    session.append_transcript("call-v3", "left arm numb", is_final=True)
    assert session.get("call-v3").transcript == "chest pain left arm numb"


def test_append_transcript_for_unknown_call_id_is_a_noop_not_a_crash():
    assert session.append_transcript("call-does-not-exist", "text", is_final=True) is None


def test_end_marks_ended_and_freezes_duration():
    session.start("call-v4", source="browser")
    ended = session.end("call-v4")
    assert ended is not None
    assert ended.status == "ended"
    assert ended.ended_at is not None
    frozen_duration = ended.duration_s
    # duration_s must not keep advancing after ended_at is set.
    assert ended.duration_s == frozen_duration


def test_end_for_unknown_call_id_returns_none():
    assert session.end("call-never-started") is None
