"""LLM-driven AI emergency-dispatcher conversation service.

Talks to the caller in whatever language they used (Hindi, English, or
Hinglish -- the model detects and mirrors it in the same call, so no
separate LanguageDetector module exists), asks one targeted follow-up
question at a time, and incrementally extracts structured patient
details. This is the "brain" behind the in-browser AI voice assistant;
it never touches triage/ranking/dispatch directly -- it only produces
a transcript and an extraction dict that the existing pipeline consumes
once `is_complete` is true.

Same in-memory module-level dict pattern as session.py: single-instance,
non-persistent, fine for this demo service.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

from google import genai
from google.genai import types as genai_types

logger = logging.getLogger("aegis.voice.conversation")

MODEL = "gemini-3.5-flash"

SYSTEM_PROMPT = """You are AEGIS, an AI emergency dispatch assistant speaking directly with a caller \
reporting a medical emergency over a phone-like voice interface. Your job is to sound calm, brief, \
and competent -- like a real 911/112/108 dispatcher -- while gathering exactly the information needed \
to send help.

LANGUAGE: Detect the language/mix the caller is using (Hindi, English, or Hinglish/code-mixed) from \
their most recent message and reply in the SAME language/mix. Do not switch languages unless the \
caller does. Keep replies short -- one or two sentences, spoken out loud by text-to-speech.

QUESTIONING STRATEGY -- ask ONE question at a time, in this priority order, skipping anything already \
known from the transcript:
1. What is the emergency / chief complaint?
2. Is the patient breathing normally?
3. Is the patient conscious?
4. Patient's approximate age?
5. Exact location (address or nearby landmark)?
Never ask a question whose answer is already in the transcript. Never ask unrelated or random \
questions. As soon as you have chief complaint + breathing + conscious + age + location (or the \
caller cannot provide more), stop asking and reassure them help is on the way.

You must respond with ONLY a JSON object (no markdown fences, no prose outside the JSON) matching \
this exact shape:
{
  "reply_text": "<what you say next, in the caller's language>",
  "extracted": {
    "name": <string or null>,
    "age": <integer or null>,
    "phone": <string or null>,
    "symptoms": <string or null>,
    "location_text": <string or null>,
    "emergency_type": <string or null>,
    "breathing": <"normal" | "abnormal" | "unknown" or null>,
    "conscious": <true | false or null>,
    "victims": <integer or null>,
    "severity": <"critical" | "serious" | "moderate" | "minor" or null>,
    "confidence": <float 0-1, your confidence in the extraction so far>
  },
  "is_complete": <true only once chief complaint, breathing, conscious, age, and location are all \
known, or the caller has clearly given all they can>
}

Only include fields in "extracted" that you can support from the conversation; use null for anything \
unknown. Never fabricate details."""


@dataclass
class ConversationTurn:
    reply_text: str
    extracted: dict[str, Any]
    is_complete: bool


@dataclass
class ConversationSession:
    call_id: str
    messages: list[dict[str, str]] = field(default_factory=list)
    patient_details: dict[str, Any] = field(default_factory=dict)
    is_complete: bool = False
    started_at: float = field(default_factory=time.monotonic)


_sessions: dict[str, ConversationSession] = {}


def get_or_create(call_id: str) -> ConversationSession:
    session = _sessions.get(call_id)
    if session is None:
        session = ConversationSession(call_id=call_id)
        _sessions[call_id] = session
    return session


def get(call_id: str) -> ConversationSession | None:
    return _sessions.get(call_id)


def end(call_id: str) -> None:
    _sessions.pop(call_id, None)


def _client() -> genai.Client:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY is not set -- required for the AI conversation feature. "
            "Add it to .env and restart the server."
        )
    return genai.Client(api_key=api_key)


# Enforced via response_schema (not just prompt instructions) -- Gemini
# validates the generated JSON against this shape server-side, which is
# far more reliable than parsing free-form "please respond with JSON"
# text and catches the occasional truncated/malformed response before it
# ever reaches this service.
_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "reply_text": {"type": "STRING"},
        "extracted": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING", "nullable": True},
                "age": {"type": "INTEGER", "nullable": True},
                "phone": {"type": "STRING", "nullable": True},
                "symptoms": {"type": "STRING", "nullable": True},
                "location_text": {"type": "STRING", "nullable": True},
                "emergency_type": {"type": "STRING", "nullable": True},
                "breathing": {"type": "STRING", "enum": ["normal", "abnormal", "unknown"], "nullable": True},
                "conscious": {"type": "BOOLEAN", "nullable": True},
                "victims": {"type": "INTEGER", "nullable": True},
                "severity": {"type": "STRING", "enum": ["critical", "serious", "moderate", "minor"], "nullable": True},
                "confidence": {"type": "NUMBER", "nullable": True},
            },
        },
        "is_complete": {"type": "BOOLEAN"},
    },
    "required": ["reply_text", "extracted", "is_complete"],
}


def _parse_turn(raw_text: str) -> ConversationTurn:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Even with response_schema enforcement, a truncated stream or a
        # rare malformed response shouldn't kill the whole turn -- fall
        # back to a safe "still gathering info" turn so the caller gets
        # a reply instead of a dropped connection, and nothing is
        # (mis)marked complete on bad data.
        return ConversationTurn(
            reply_text="Sorry, could you say that again?",
            extracted={},
            is_complete=False,
        )
    extracted = data.get("extracted") or {}
    return ConversationTurn(
        reply_text=data.get("reply_text", ""),
        extracted={k: v for k, v in extracted.items() if v is not None},
        is_complete=bool(data.get("is_complete", False)),
    )


GEMINI_RETRY_ATTEMPTS = 3
GEMINI_RETRY_DELAY_S = 1.0

_FALLBACK_REPLY = "Sorry, I'm having trouble hearing you clearly. Could you say that again?"


def _call_gemini(client: genai.Client, contents: list[genai_types.Content]) -> str:
    """One attempt at the Gemini call, isolated so next_turn can retry it.
    Any failure (rate limit, 5xx, network) propagates -- retry/fallback
    behavior lives in next_turn, not here."""
    response = client.models.generate_content(
        model=MODEL,
        contents=contents,
        config=genai_types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            response_mime_type="application/json",
            response_schema=_RESPONSE_SCHEMA,
            max_output_tokens=1024,
        ),
    )
    return response.text or "{}"


def next_turn(call_id: str, latest_user_utterance: str) -> ConversationTurn:
    """Advance the conversation by one turn: send the caller's latest final
    transcript chunk to the model, update session state, and return what the
    AI should say next plus the newly-merged patient extraction.

    Design Law 4 applies here same as every other external call in this
    system: a transient Gemini failure (rate limit, 503 capacity) gets one
    short retry, and if that also fails, the caller gets a safe "please
    repeat" turn instead of a dropped call -- never a crash mid-conversation.
    """
    session = get_or_create(call_id)
    session.messages.append({"role": "user", "content": latest_user_utterance})

    client = _client()
    # Gemini's turn roles are "user" / "model" (not Anthropic's "assistant"),
    # so history stored with the generic {"role", "content"} shape is
    # translated at the call boundary rather than baked into the session
    # dataclass -- keeps ConversationSession provider-agnostic.
    contents = [
        genai_types.Content(
            role="model" if m["role"] == "assistant" else "user",
            parts=[genai_types.Part.from_text(text=m["content"])],
        )
        for m in session.messages
    ]

    raw_text: str | None = None
    for attempt in range(GEMINI_RETRY_ATTEMPTS):
        try:
            raw_text = _call_gemini(client, contents)
            break
        except Exception as exc:
            logger.warning(
                "Gemini call failed (attempt %d/%d) for call %s: %s",
                attempt + 1, GEMINI_RETRY_ATTEMPTS, call_id, exc,
            )
            if attempt == GEMINI_RETRY_ATTEMPTS - 1:
                break
            time.sleep(GEMINI_RETRY_DELAY_S)

    if raw_text is None:
        # Every attempt failed -- don't merge a user turn into history with
        # no assistant reply to match it (would desync the user/model
        # alternation Gemini expects next turn), and don't mark anything
        # extracted/complete from a call that never actually ran.
        return ConversationTurn(reply_text=_FALLBACK_REPLY, extracted={}, is_complete=False)

    turn = _parse_turn(raw_text)

    session.messages.append({"role": "assistant", "content": raw_text})
    session.patient_details.update(turn.extracted)
    session.is_complete = turn.is_complete

    return turn
