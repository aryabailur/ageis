"""Deterministic pre-arrival guidance lookup table. Design Law 1: this is
plain protocol-table code, never LLM-generated -- dispatch_prearrival_guidance
only does a lookup against this table based on triage facts already
extracted, and it never blocks or informs the dispatch decision itself.
"""

from __future__ import annotations

from aegis_contracts import Incident

CPR_HANDS_ONLY_STEPS = [
    "Confirm the patient is unresponsive and not breathing normally.",
    "Have the caller kneel beside the patient's chest.",
    "Place the heel of one hand on the center of the chest, other hand on top.",
    "Push hard and fast, at least 2 inches deep, at 100-120 compressions per minute.",
    "Let the chest rise fully between compressions. Do not stop until help arrives.",
]

BLEEDING_CONTROL_STEPS = [
    "Apply firm, direct pressure to the wound with a clean cloth or the caller's hand.",
    "Do not remove the cloth if it soaks through -- add more on top.",
    "If on a limb and bleeding is severe, elevate it above heart level if possible.",
    "Keep steady pressure applied until the ambulance arrives.",
]

CHOKING_ADULT_STEPS = [
    "Ask the patient if they can cough or speak. If yes, encourage coughing.",
    "If they cannot breathe, cough, or speak, stand behind them and give 5 back blows.",
    "Follow with 5 abdominal thrusts (the Heimlich maneuver).",
    "Alternate 5 back blows and 5 abdominal thrusts until the object clears or help arrives.",
]

STAY_ON_LINE_STEPS = [
    "Stay on the line with me.",
    "Keep the patient still and comfortable.",
    "Do not give the patient food or water.",
    "Tell me immediately if their condition changes.",
]


def lookup_prearrival_protocol(incident: Incident) -> tuple[str, list[str], int | None]:
    """Returns (protocol_id, steps, metronome_bpm). Pure lookup, no side
    effects -- see dispatch_prearrival_guidance for how this gets timestamped
    and attached to state."""
    if incident.chief_complaint == "CARDIAC" and incident.breathing_normally is False:
        return "CPR_HANDS_ONLY", CPR_HANDS_ONLY_STEPS, 110
    if incident.major_bleeding:
        return "BLEEDING_CONTROL", BLEEDING_CONTROL_STEPS, None
    if incident.chief_complaint == "CHOKING":
        return "CHOKING_ADULT", CHOKING_ADULT_STEPS, None
    return "STAY_ON_LINE", STAY_ON_LINE_STEPS, None
