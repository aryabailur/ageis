"""Design Law 2: autonomous by default, human-gated only under
uncertainty. These are LangGraph conditional-edge functions — they read
state and return the name of the next node, never mutate anything.
"""

from __future__ import annotations

from aegis_contracts import DispatchState, Priority


def intake_review_gate(state: DispatchState) -> str:
    if state.triage is None:
        return "fail_safely"
    if state.triage.priority == Priority.UNKNOWN:
        return "await_review"
    return "load_resources"


def assignment_review_gate(state: DispatchState) -> str:
    if state.selected is None:
        return "await_review"
    return "reserve_ambulance"


def after_validate_reservation(state: DispatchState) -> str:
    valid = (
        state.reservation is not None
        and state.reservation.confirmed
        and state.selected is not None
        and state.selected.hospital.status == "OPEN"
    )
    if valid:
        return "simulate_dispatch"
    if state.replan_count < state.max_replans:
        return "replan"
    return "fail_safely"


def after_replan(state: DispatchState) -> str:
    if state.selected is None:
        return "fail_safely"
    return "validate_proposal"


def mark_awaiting_review(state: DispatchState) -> dict:
    reason = "chief_complaint UNKNOWN or transcript_quality low"
    if state.selected is None and state.triage is not None and state.triage.priority != Priority.UNKNOWN:
        reason = "no candidate satisfies hard constraints (ALS/specialty/availability)"
    return {"status": "AWAITING_REVIEW", "review_reason": reason}
