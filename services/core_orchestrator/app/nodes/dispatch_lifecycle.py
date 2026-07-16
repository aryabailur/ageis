"""validate_proposal -> reserve_ambulance -> validate_reservation ->
simulate_dispatch -> monitor_or_finish, plus the bounded replan/fail_safely
escape hatches. Grouped together because each step is small and they form
one linear lifecycle once a candidate has been selected.
"""

from __future__ import annotations

from aegis_contracts import DispatchState, DispatchStatus, TimingEntry, load_default_registry
from aegis_contracts.fallback import call_with_fallback
from aegis_contracts.timing import clock

from .. import reservation_store
from ..mcp_client import call_tool

HOSPITAL_DATA_SERVICE = "hospital_ambulance_data"


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
    except Exception as exc:
        # Covers both the deliberate "already booked elsewhere" RuntimeError
        # AND any other Supabase-layer failure (timeout, transient
        # connection error under concurrent load) that reservation_store
        # re-raises under its original type -- either way this call must
        # degrade to a bounded replan/fail_safely, never an unhandled crash.
        entry = TimingEntry(step="reserve_ambulance", start=start, end=clock())
        return {"failure_reason": str(exc), "timing_log": state.timing_log + [entry]}

    entry = TimingEntry(step="reserve_ambulance", start=start, end=clock())
    return {"reservation": reservation, "timing_log": state.timing_log + [entry]}


async def validate_reservation(state: DispatchState) -> dict:
    """The pre-dispatch checkpoint: re-checks the selected hospital's
    LIVE status right before committing, instead of trusting the
    snapshot captured back when it was ranked. This is what actually
    notices a hospital flipping to DIVERSION mid-flight and is what makes
    the bounded replan demoable, not just theoretically wired up."""
    start = clock()
    hospital_id = state.selected.hospital.id
    registry = load_default_registry()
    service = registry.get(HOSPITAL_DATA_SERVICE)

    async def call_live():
        return await call_tool(service.base_url, "get_hospital_capacity", {"hospital_id": hospital_id})

    result = await call_with_fallback(
        call_live,
        lambda: {"status": state.selected.hospital.status},
        primary_label=f"mcp:{HOSPITAL_DATA_SERVICE}",
        fallback_label="stale_snapshot_fallback",
    )

    entry = TimingEntry(step="validate_reservation", start=start, end=clock())
    return {
        "hospital_status_at_validation": result.value["status"],
        "timing_log": state.timing_log + [entry],
    }


def simulate_dispatch(state: DispatchState) -> dict:
    start = clock()
    entry = TimingEntry(step="simulate_dispatch", start=start, end=clock())
    return {"status": DispatchStatus.DISPATCHED, "timing_log": state.timing_log + [entry]}


def monitor_or_finish(state: DispatchState) -> dict:
    start = clock()
    entry = TimingEntry(step="monitor_or_finish", start=start, end=clock())
    return {"status": DispatchStatus.COMPLETED, "timing_log": state.timing_log + [entry]}


def replan(state: DispatchState) -> dict:
    """The invalidated reservation (e.g. its hospital just went to
    DIVERSION) is released first -- reservations.call_id is unique, so
    without this, retrying under the same call_id would just hand back
    the stale reservation instead of booking the new pairing."""
    start = clock()
    reservation_store.release(state.call_id)

    tried = set(state.tried_pairs) | {f"{state.selected.ambulance.id}|{state.selected.hospital.id}"}
    remaining = [
        c
        for c in state.candidates
        if not c.rejected and f"{c.ambulance.id}|{c.hospital.id}" not in tried
    ]
    next_selected = min(remaining, key=lambda c: c.score) if remaining else None
    entry = TimingEntry(step="replan", start=start, end=clock())
    return {
        "selected": next_selected,
        "reservation": None,
        "replan_count": state.replan_count + 1,
        "tried_pairs": sorted(tried),
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
