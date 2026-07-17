"""LLM turn-taking logic for the AI conversation feature, with the
Gemini client boundary mocked out -- no network, deterministic,
same style as test_voice_session.py."""

from __future__ import annotations

import json
from types import SimpleNamespace

from app.voice import conversation


class _FakeModels:
    def __init__(self, text: str):
        self._text = text

    def generate_content(self, **kwargs):
        return SimpleNamespace(text=self._text)


def _patch_client(monkeypatch, payload: dict) -> None:
    monkeypatch.setattr(conversation, "_client", lambda: SimpleNamespace(models=_FakeModels(json.dumps(payload))))


def test_next_turn_parses_reply_and_merges_extraction(monkeypatch):
    _patch_client(
        monkeypatch,
        {
            "reply_text": "Is the patient breathing normally?",
            "extracted": {"emergency_type": "chest pain", "confidence": 0.6},
            "is_complete": False,
        },
    )

    turn = conversation.next_turn("call-c1", "my father is having chest pain")

    assert turn.reply_text == "Is the patient breathing normally?"
    assert turn.extracted == {"emergency_type": "chest pain", "confidence": 0.6}
    assert turn.is_complete is False

    session = conversation.get("call-c1")
    assert session is not None
    assert session.patient_details == {"emergency_type": "chest pain", "confidence": 0.6}
    assert session.is_complete is False
    assert session.messages[0] == {"role": "user", "content": "my father is having chest pain"}
    assert session.messages[1]["role"] == "assistant"


def test_next_turn_merges_across_multiple_turns_without_dropping_fields(monkeypatch):
    _patch_client(
        monkeypatch,
        {
            "reply_text": "What is the patient's age?",
            "extracted": {"breathing": "abnormal"},
            "is_complete": False,
        },
    )
    conversation.next_turn("call-c2", "chest pain, breathing is bad")

    _patch_client(
        monkeypatch,
        {
            "reply_text": "Help is on the way.",
            "extracted": {"age": 62},
            "is_complete": True,
        },
    )
    turn = conversation.next_turn("call-c2", "he is 62")

    assert turn.is_complete is True
    session = conversation.get("call-c2")
    # Fields from the FIRST turn must still be present after the second --
    # merge, not overwrite.
    assert session.patient_details == {"breathing": "abnormal", "age": 62}


def test_next_turn_drops_null_fields_from_extraction(monkeypatch):
    _patch_client(
        monkeypatch,
        {
            "reply_text": "okay",
            "extracted": {"name": None, "age": 30, "phone": None},
            "is_complete": False,
        },
    )
    turn = conversation.next_turn("call-c3", "I am 30 years old")
    assert turn.extracted == {"age": 30}


def test_next_turn_handles_markdown_fenced_json(monkeypatch):
    payload = {"reply_text": "noted", "extracted": {}, "is_complete": False}
    fenced = "```json\n" + json.dumps(payload) + "\n```"
    monkeypatch.setattr(conversation, "_client", lambda: SimpleNamespace(models=_FakeModels(fenced)))

    turn = conversation.next_turn("call-c4", "hello")
    assert turn.reply_text == "noted"


def test_get_or_create_reuses_the_same_session():
    a = conversation.get_or_create("call-c5")
    b = conversation.get_or_create("call-c5")
    assert a is b


def test_end_removes_the_session():
    conversation.get_or_create("call-c6")
    conversation.end("call-c6")
    assert conversation.get("call-c6") is None


def test_end_for_unknown_call_id_is_a_noop_not_a_crash():
    conversation.end("call-never-existed")


def test_quota_exhaustion_uses_deterministic_fallback_without_retrying_gemini(monkeypatch):
    attempts = 0

    def quota_failure(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("429 RESOURCE_EXHAUSTED: quota exceeded")

    monkeypatch.setattr(conversation, "_client", lambda: SimpleNamespace())
    monkeypatch.setattr(conversation, "_call_gemini", quota_failure)

    turn = conversation.next_turn("call-quota-failover", "severe chest pain")

    assert attempts == 1
    assert turn.reply_text == "Is the patient breathing normally?"
    assert turn.extracted["emergency_type"] == "cardiac"
    assert "conscious" not in turn.extracted
    assert turn.extracted["severity"] == "serious"


def test_deterministic_intake_completes_when_gemini_is_down(monkeypatch):
    monkeypatch.setattr(conversation, "_client", lambda: SimpleNamespace())
    monkeypatch.setattr(
        conversation,
        "_call_gemini",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("RESOURCE_EXHAUSTED quota")),
    )
    call_id = "call-local-fallback"

    first = conversation.next_turn(call_id, "My father has severe chest pain")
    assert first.reply_text == "Is the patient breathing normally?"
    conversation.next_turn(call_id, "No")
    conversation.next_turn(call_id, "Yes")
    conversation.next_turn(call_id, "62")
    final = conversation.next_turn(call_id, "Near Lilavati Hospital in Bandra")

    assert final.is_complete is True
    session = conversation.get(call_id)
    assert session is not None
    assert session.patient_details["emergency_type"] == "cardiac"
    assert session.patient_details["breathing"] == "abnormal"
    assert session.patient_details["conscious"] is True
    assert session.patient_details["age"] == 62
    assert session.patient_details["location_text"] == "Near Lilavati Hospital in Bandra"
