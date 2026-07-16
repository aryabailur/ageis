"""Deterministic protocol-table lookup -- every branch, no network."""

from __future__ import annotations

from aegis_contracts import DispatchState, Incident, TranscriptQuality
from app.nodes.ingest_extract_triage import dispatch_prearrival_guidance


def _state_with_incident(**incident_kwargs) -> DispatchState:
    incident = Incident(
        raw_transcript="n/a",
        transcript_quality=TranscriptQuality.HIGH,
        **incident_kwargs,
    )
    return DispatchState(call_id="c1", incident=incident)


def test_cardiac_not_breathing_gets_cpr_hands_only_at_110_bpm():
    state = _state_with_incident(chief_complaint="CARDIAC", breathing_normally=False)
    update = dispatch_prearrival_guidance(state)
    assert update["prearrival"].protocol_id == "CPR_HANDS_ONLY"
    assert update["prearrival"].metronome_bpm == 110
    assert len(update["prearrival"].steps) > 0


def test_cardiac_but_breathing_normally_does_not_get_cpr():
    state = _state_with_incident(chief_complaint="CARDIAC", breathing_normally=True)
    update = dispatch_prearrival_guidance(state)
    assert update["prearrival"].protocol_id != "CPR_HANDS_ONLY"


def test_major_bleeding_gets_bleeding_control():
    state = _state_with_incident(chief_complaint="BLEEDING", major_bleeding=True)
    update = dispatch_prearrival_guidance(state)
    assert update["prearrival"].protocol_id == "BLEEDING_CONTROL"
    assert update["prearrival"].metronome_bpm is None


def test_choking_gets_choking_adult_protocol():
    state = _state_with_incident(chief_complaint="CHOKING")
    update = dispatch_prearrival_guidance(state)
    assert update["prearrival"].protocol_id == "CHOKING_ADULT"


def test_default_case_gets_stay_on_line():
    state = _state_with_incident(chief_complaint="UNKNOWN")
    update = dispatch_prearrival_guidance(state)
    assert update["prearrival"].protocol_id == "STAY_ON_LINE"


def test_prearrival_always_tagged_with_protocol_data_source_never_a_model_guess():
    state = _state_with_incident(chief_complaint="CARDIAC", breathing_normally=False)
    update = dispatch_prearrival_guidance(state)
    assert update["prearrival"].data_source == "protocol"


def test_appends_exactly_one_timing_log_entry():
    state = _state_with_incident(chief_complaint="CARDIAC", breathing_normally=False)
    update = dispatch_prearrival_guidance(state)
    assert len(update["timing_log"]) == 1
    assert update["timing_log"][0].step == "dispatch_prearrival_guidance"
