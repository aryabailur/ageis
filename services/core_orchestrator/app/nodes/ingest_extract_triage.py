"""ingest_call -> extract_incident -> apply_triage_rules -> dispatch_prearrival_guidance.

Kept in one module because each step is a handful of lines; split further
only if a step grows real complexity of its own.
"""

from __future__ import annotations

from aegis_contracts import DispatchState, PrearrivalGuidance, Priority, TimingEntry, TranscriptQuality, TriageResult
from aegis_contracts.fallback import call_with_fallback
from aegis_contracts.timing import clock

from ..extractors import keyword_extract, llm_extract_async
from ..protocols import lookup_prearrival_protocol


def ingest_call(state: DispatchState) -> dict:
    entry = TimingEntry(step="ingest_call", start=clock())
    entry.end = clock()
    return {"timing_log": state.timing_log + [entry]}


async def extract_incident(state: DispatchState) -> dict:
    start = clock()

    async def call_llm():
        return await llm_extract_async(state.raw_transcript, state.caller_lat, state.caller_lng)

    result = await call_with_fallback(
        call_llm,
        lambda: keyword_extract(state.raw_transcript, state.caller_lat, state.caller_lng),
        primary_label="llm_extraction",
        fallback_label="keyword_extractor_fallback",
    )
    incident = result.value
    if result.used_fallback:
        incident = incident.model_copy(update={"extraction_data_source": result.data_source})

    entry = TimingEntry(step="extract_incident", start=start, end=clock())
    return {"incident": incident, "timing_log": state.timing_log + [entry]}


# --- deterministic triage rule table (Design Law 1: never LLM judgment) ---

def _apply_rules(incident) -> TriageResult:
    if incident.transcript_quality == TranscriptQuality.LOW or incident.chief_complaint == "UNKNOWN":
        return TriageResult(priority=Priority.UNKNOWN, rule_ids=["RULE_UNKNOWN_OR_GARBLED"])

    if incident.chief_complaint == "CARDIAC" and incident.breathing_normally is False:
        return TriageResult(
            priority=Priority.P1,
            rule_ids=["RULE_CARDIAC_NOT_BREATHING"],
            requires_als=True,
            required_hospital_specialty="cardiac",
        )

    if incident.chief_complaint == "CARDIAC":
        return TriageResult(
            priority=Priority.P2,
            rule_ids=["RULE_CARDIAC_STABLE"],
            requires_als=True,
            required_hospital_specialty="cardiac",
        )

    if incident.chief_complaint == "BLEEDING" and incident.major_bleeding:
        return TriageResult(
            priority=Priority.P1,
            rule_ids=["RULE_MAJOR_BLEEDING"],
            requires_als=True,
            required_hospital_specialty="trauma",
        )

    if incident.chief_complaint == "CHOKING":
        return TriageResult(priority=Priority.P1, rule_ids=["RULE_CHOKING"], requires_als=False)

    return TriageResult(priority=Priority.P3, rule_ids=["RULE_DEFAULT_STABLE"], requires_als=False)


def apply_triage_rules(state: DispatchState) -> dict:
    start = clock()
    triage = _apply_rules(state.incident)
    entry = TimingEntry(step="apply_triage_rules", start=start, end=clock())
    return {"triage": triage, "timing_log": state.timing_log + [entry]}


def dispatch_prearrival_guidance(state: DispatchState) -> dict:
    """Fires immediately after triage, before the review gate or any
    resource lookup -- help starts before an ambulance has even been
    chosen. Pure protocol-table lookup (see protocols.py); never LLM,
    never blocks, never affects the dispatch decision."""
    start = clock()
    protocol_id, steps, bpm = lookup_prearrival_protocol(state.incident)
    prearrival = PrearrivalGuidance(
        protocol_id=protocol_id,
        chief_complaint=state.incident.chief_complaint,
        steps=steps,
        metronome_bpm=bpm,
        started_at=start,
    )
    entry = TimingEntry(step="dispatch_prearrival_guidance", start=start, end=clock())
    return {"prearrival": prearrival, "timing_log": state.timing_log + [entry]}
