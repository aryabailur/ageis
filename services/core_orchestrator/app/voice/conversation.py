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
import re
import time
from dataclasses import dataclass, field
from typing import Any

from google import genai
from google.genai import types as genai_types

logger = logging.getLogger("aegis.voice.conversation")

MODEL = "gemini-2.5-flash"

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

def _contains(text: str, *phrases: str) -> bool:
    return any(phrase in text for phrase in phrases)


def _deterministic_fallback_turn(session: ConversationSession, latest: str) -> ConversationTurn:
    """Continue a minimal intake locally when every AI provider is unavailable.

    Only explicitly stated facts are extracted. This function never diagnoses,
    ranks resources, or dispatches anything.
    """
    text = " ".join(latest.lower().split())
    details = dict(session.patient_details)
    required = ("symptoms", "breathing", "conscious", "age", "location_text")
    expected = next((field for field in required if details.get(field) is None), None)

    if details.get("symptoms") is None and (
        expected == "symptoms"
        or _contains(
            text,
            "chest pain",
            "heart attack",
            "cardiac",
            "bleeding",
            "accident",
            "choking",
            "seizure",
            "fainted",
            "pain",
        )
    ):
        details["symptoms"] = latest.strip()
        if _contains(text, "chest pain", "heart attack", "cardiac"):
            details["emergency_type"] = "cardiac"
        elif _contains(text, "bleeding", "blood loss"):
            details["emergency_type"] = "bleeding"
        elif _contains(text, "accident", "crash", "collision"):
            details["emergency_type"] = "accident"
        elif _contains(text, "choking"):
            details["emergency_type"] = "choking"

    abnormal_breathing = _contains(
        text,
        "not breathing",
        "isn't breathing",
        "isnt breathing",
        "can't breathe",
        "cant breathe",
        "difficulty breathing",
        "breathing is bad",
        "gasping",
        "saans nahi",
        "saans nahin",
    )
    normal_breathing = _contains(text, "breathing normally", "breathing is normal", "breathing is fine")
    if abnormal_breathing:
        details["breathing"] = "abnormal"
    elif normal_breathing or (expected == "breathing" and text in {"yes", "yes he is", "yes she is", "haan", "ha"}):
        details["breathing"] = "normal"
    elif expected == "breathing" and text in {"no", "no he isn't", "no she isn't", "nahi", "nahin"}:
        details["breathing"] = "abnormal"

    if _contains(text, "unconscious", "not conscious", "unresponsive", "passed out", "behosh"):
        details["conscious"] = False
    elif _contains(text, "conscious", "responsive", "awake", "hosh mein"):
        details["conscious"] = True
    elif expected == "conscious" and text in {"yes", "yes he is", "yes she is", "haan", "ha"}:
        details["conscious"] = True
    elif expected == "conscious" and text in {"no", "no he isn't", "no she isn't", "nahi", "nahin"}:
        details["conscious"] = False

    age_match = re.search(r"\b(?:age(?:d)?|years? old|saal|umar)\D{0,8}(\d{1,3})\b", text)
    if age_match is None:
        age_match = re.search(r"\b(\d{1,3})\s*(?:years? old|year|saal)\b", text)
    if age_match is None and expected == "age":
        age_match = re.fullmatch(r"\D*(\d{1,3})\D*", text)
    if age_match:
        age = int(age_match.group(1))
        if 0 < age <= 120:
            details["age"] = age

    location_markers = ("near ", "at ", "in ", "address", "landmark", "road", "street", "hospital", "station")
    if details.get("location_text") is None and (
        expected == "location_text" or any(marker in text for marker in location_markers)
    ):
        if len(text) >= 3 and text not in {"yes", "no", "haan", "nahi", "nahin"}:
            details["location_text"] = latest.strip()

    if details.get("breathing") == "abnormal" or details.get("conscious") is False:
        details["severity"] = "critical"
    elif details.get("emergency_type") in {"cardiac", "bleeding", "choking", "accident"}:
        details["severity"] = "serious"
    details["confidence"] = round(sum(details.get(field) is not None for field in required) / len(required), 2)

    missing = next((field for field in required if details.get(field) is None), None)
    replies = {
        "symptoms": "Please briefly tell me what happened and the main symptom.",
        "breathing": "Is the patient breathing normally?",
        "conscious": "Is the patient conscious and responding?",
        "age": "What is the patient's approximate age?",
        "location_text": "What is your exact location or nearest landmark?",
    }
    is_complete = missing is None
    reply = (
        "Thank you. I have the required details and am transferring them to the AEGIS dispatch system."
        if is_complete
        else replies[missing]
    )
    extracted = {key: value for key, value in details.items() if session.patient_details.get(key) != value}
    return ConversationTurn(reply_text=reply, extracted=extracted, is_complete=is_complete)


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
    system: transient Gemini failures are retried, while exhausted quota or
    provider downtime immediately falls back to the local protocol intake.
    The caller is never dropped and the fallback only records explicit facts.
    """
    session = get_or_create(call_id)
    session.messages.append({"role": "user", "content": latest_user_utterance})

    try:
        client = _client()
    except Exception as exc:
        logger.warning("Gemini client unavailable for call %s: %s", call_id, exc)
        client = None
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
    for attempt in range(GEMINI_RETRY_ATTEMPTS if client is not None else 0):
        try:
            assert client is not None
            raw_text = _call_gemini(client, contents)
            break
        except Exception as exc:
            logger.warning(
                "Gemini call failed (attempt %d/%d) for call %s: %s",
                attempt + 1, GEMINI_RETRY_ATTEMPTS, call_id, exc,
            )
            if "RESOURCE_EXHAUSTED" in str(exc) or "quota" in str(exc).lower():
                break
            if attempt == GEMINI_RETRY_ATTEMPTS - 1:
                break
            time.sleep(GEMINI_RETRY_DELAY_S)

    if raw_text is None:
        logger.warning("Gemini unavailable for call %s; using deterministic intake", call_id)
        turn = _deterministic_fallback_turn(session, latest_user_utterance)
        raw_text = json.dumps(
            {"reply_text": turn.reply_text, "extracted": turn.extracted, "is_complete": turn.is_complete}
        )
    else:
        turn = _parse_turn(raw_text)

    session.messages.append({"role": "assistant", "content": raw_text})
    session.patient_details.update(turn.extracted)
    session.is_complete = turn.is_complete

    return turn
