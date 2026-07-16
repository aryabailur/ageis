"""Design Law 1: the LLM only listens. Extraction pulls STATED facts out
of the transcript -- chief complaint, breathing, bleeding, how garbled the
audio was -- and never infers severity or priority; that's apply_triage_rules'
job, always deterministic. Design Law 4: the LLM call itself is an
external dependency with a short timeout and a labeled fallback, exactly
like every MCP/routing/DB call elsewhere in this system -- see
extract_incident in nodes/ingest_extract_triage.py, which wraps
llm_extract_async in call_with_fallback.
"""

from __future__ import annotations

import json
import os

from dotenv import find_dotenv, load_dotenv
from openai import AsyncOpenAI

from aegis_contracts import Incident, TranscriptQuality

load_dotenv(find_dotenv(usecwd=True))

CARDIAC_TERMS = ["chest pain", "arm numb", "cardiac", "heart attack"]
BLEEDING_TERMS = ["bleeding", "blood loss", "hemorrhage"]
CHOKING_TERMS = ["choking", "can't breathe", "cant breathe", "airway blocked"]
NOT_BREATHING_TERMS = ["not breathing", "breathing right", "gasping"]
GARBLED_MARKERS = ["[inaudible]", "[static]", "???"]

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_MODEL = "llama-3.1-8b-instant"
GROQ_TIMEOUT_S = 3.0

EXTRACTION_SYSTEM_PROMPT = """You extract STATED facts from a 911 call transcript. You do not diagnose, \
assess severity, or infer anything the caller did not say. If something isn't mentioned, say so -- do not guess.

Respond with ONLY a JSON object with exactly these keys:
- "chief_complaint": one of "CARDIAC", "BLEEDING", "CHOKING", or "UNKNOWN" if none of those are clearly stated \
(use UNKNOWN rather than guessing a category that isn't clearly present).
- "breathing_normally": true, false, or null if not mentioned.
- "major_bleeding": true, false, or null if not mentioned.
- "conscious": true, false, or null if not mentioned.
- "transcript_quality": "high", "medium", or "low" -- low if the transcript is garbled, contains \
markers like [inaudible]/[static], or is otherwise hard to make sense of.

Never invent facts. Never assess how serious the situation is -- that is not your job."""


def _contains_any(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def keyword_extract(raw_transcript: str, lat: float | None = None, lng: float | None = None) -> Incident:
    """Deterministic keyword-matching extractor. This is the fallback
    Design Law 4 requires for the LLM call -- and also what the system
    runs on with zero API keys configured. Same output shape as the LLM
    path: facts only, no judgment."""
    quality = TranscriptQuality.LOW if _contains_any(raw_transcript, GARBLED_MARKERS) else TranscriptQuality.HIGH

    chief_complaint = "UNKNOWN"
    if _contains_any(raw_transcript, CARDIAC_TERMS):
        chief_complaint = "CARDIAC"
    elif _contains_any(raw_transcript, BLEEDING_TERMS):
        chief_complaint = "BLEEDING"
    elif _contains_any(raw_transcript, CHOKING_TERMS):
        chief_complaint = "CHOKING"

    breathing_normally: bool | None = None
    if _contains_any(raw_transcript, NOT_BREATHING_TERMS):
        breathing_normally = False

    major_bleeding = _contains_any(raw_transcript, BLEEDING_TERMS) or None

    return Incident(
        raw_transcript=raw_transcript,
        chief_complaint=chief_complaint,
        breathing_normally=breathing_normally,
        major_bleeding=major_bleeding,
        location_lat=lat,
        location_lng=lng,
        transcript_quality=quality,
        extraction_data_source="keyword_extractor_fallback",
    )


def _groq_client() -> AsyncOpenAI:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")
    return AsyncOpenAI(api_key=api_key, base_url=GROQ_BASE_URL)


async def llm_extract_async(raw_transcript: str, lat: float | None = None, lng: float | None = None) -> Incident:
    """Real extraction via Groq (llama-3.1-8b-instant). Structured JSON
    output, temperature 0 -- this is retrieval of stated facts, not
    creative generation. Any failure (no key, timeout, bad JSON) is the
    caller's problem to fall back from, not this function's."""
    client = _groq_client()
    response = await client.chat.completions.create(
        model=GROQ_MODEL,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": raw_transcript},
        ],
        timeout=GROQ_TIMEOUT_S,
    )
    data = json.loads(response.choices[0].message.content)

    chief_complaint = data.get("chief_complaint") or "UNKNOWN"
    if chief_complaint not in ("CARDIAC", "BLEEDING", "CHOKING", "UNKNOWN"):
        chief_complaint = "UNKNOWN"

    quality_raw = (data.get("transcript_quality") or "medium").lower()
    quality = TranscriptQuality(quality_raw) if quality_raw in ("high", "medium", "low") else TranscriptQuality.MEDIUM

    return Incident(
        raw_transcript=raw_transcript,
        chief_complaint=chief_complaint,
        breathing_normally=data.get("breathing_normally"),
        major_bleeding=data.get("major_bleeding"),
        conscious=data.get("conscious"),
        location_lat=lat,
        location_lng=lng,
        transcript_quality=quality,
        extraction_data_source=f"llm_extraction:groq/{GROQ_MODEL}",
    )
