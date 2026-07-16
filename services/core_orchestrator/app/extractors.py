"""Design Law 1: the LLM only listens. Extraction pulls STATED facts out
of the transcript — it never infers severity. This module is itself a
plugin point: swap AEGIS_EXTRACTOR_BACKEND to point at a real LLM-backed
extractor later without touching the graph.
"""

from __future__ import annotations

import os

from aegis_contracts import Incident, TranscriptQuality

CARDIAC_TERMS = ["chest pain", "arm numb", "cardiac", "heart attack"]
BLEEDING_TERMS = ["bleeding", "blood loss", "hemorrhage"]
CHOKING_TERMS = ["choking", "can't breathe", "cant breathe", "airway blocked"]
NOT_BREATHING_TERMS = ["not breathing", "breathing right", "gasping"]
GARBLED_MARKERS = ["[inaudible]", "[static]", "???"]


def _contains_any(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def keyword_extract(raw_transcript: str, lat: float | None = None, lng: float | None = None) -> Incident:
    """Deterministic keyword-matching extractor. This is the default
    "LLM" stand-in so the workflow runs with zero API keys; the shape it
    produces (Incident) is exactly what a real LLM extractor must also
    produce — facts only, no judgment."""
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
        extraction_data_source="keyword_extractor",
    )


def llm_extract(raw_transcript: str, lat: float | None = None, lng: float | None = None) -> Incident:
    raise NotImplementedError(
        "LLM-backed extraction is a plug point, not wired up in the CORE-tier build. "
        "Set AEGIS_EXTRACTOR_BACKEND=keyword (default) or implement this function."
    )


_BACKENDS = {"keyword": keyword_extract, "llm": llm_extract}


def get_extractor():
    backend = os.environ.get("AEGIS_EXTRACTOR_BACKEND", "keyword")
    if backend not in _BACKENDS:
        raise ValueError(f"Unknown AEGIS_EXTRACTOR_BACKEND '{backend}'. Options: {list(_BACKENDS)}")
    return _BACKENDS[backend]
