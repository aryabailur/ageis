"""validate_proposal -> reserve_ambulance -> validate_reservation ->
simulate_dispatch -> monitor_or_finish, plus the bounded replan/fail_safely
escape hatches. Grouped together because each step is small and they form
one linear lifecycle once a candidate has been selected.
"""

from __future__ import annotations

from aegis_contracts import DispatchState, DispatchStatus, TimingEntry
from aegis_contracts.timing import clock

from .. import reservation_store


def validate_proposal(state: DispatchState) -> dict:
    start = clock()
    selected = state.selected
    triage = state.triage
    valid = (
        selected is not None
        and not selected.rejected
        and (not triage.requires_als or selected.ambulance.capability == "ALS")
        and (not triage.required_hospital_specialty or triage.required_hospital_specialty in selected.hospital.specialties)
        and selected.hospital.status == "OPEN"
    )
    entry = TimingEntry(step="validate_proposal", start=start, end=clock())
    update: dict = {"timing_log": state.timing_log + [entry]}
    if not valid:
        update["selected"] = None
    return update


def reserve_ambulance(state: DispatchState) -> dict:
    start = clock()
    selected = state.selected
    try:
        reservation, _already_existed = reservation_store.reserve(
            state.call_id, selected.ambulance.id, selected.hospital.id
        )
    except RuntimeError as exc:
        entry = TimingEntry(step="reserve_ambulance", start=start, end=clock())
        return {"failure_reason": str(exc), "timing_log": state.timing_log + [entry]}

    entry = TimingEntry(step="reserve_ambulance", start=start, end=clock())
    return {"reservation": reservation, "timing_log": state.timing_log + [entry]}


def validate_reservation(state: DispatchState) -> dict:
    start = clock()
    entry = TimingEntry(step="validate_reservation", start=start, end=clock())
    return {"timing_log": state.timing_log + [entry]}


def simulate_dispatch(state: DispatchState) -> dict:
    start = clock()
    entry = TimingEntry(step="simulate_dispatch", start=start, end=clock())
    return {"status": DispatchStatus.DISPATCHED, "timing_log": state.timing_log + [entry]}


def monitor_or_finish(state: DispatchState) -> dict:
    start = clock()
    entry = TimingEntry(step="monitor_or_finish", start=start, end=clock())
    return {"status": DispatchStatus.COMPLETED, "timing_log": state.timing_log + [entry]}


def replan(state: DispatchState) -> dict:
    start = clock()
    remaining = [c for c in state.candidates if not c.rejected and c is not state.selected]
    next_selected = min(remaining, key=lambda c: c.score) if remaining else None
    entry = TimingEntry(step="replan", start=start, end=clock())
    return {
        "selected": next_selected,
        "replan_count": state.replan_count + 1,
        "timing_log": state.timing_log + [entry],
    }


def fail_safely(state: DispatchState) -> dict:
    start = clock()
    reason = state.failure_reason or "no viable candidate after exhausting replan budget"
    entry = TimingEntry(step="fail_safely", start=start, end=clock())
    return {
        "status": DispatchStatus.FAILED,
        "failure_reason": reason,
        "timing_log": state.timing_log + [entry],
    }
