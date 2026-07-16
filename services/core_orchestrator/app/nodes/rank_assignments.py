"""Deterministic scoring only (Design Law 1). Hard constraints (ALS
requirement, hospital specialty, capacity) reject candidates with a
structured {reason_code, human_text} so the dashboard can show "why not
the nearer one" without re-deriving any logic.

complexity_score is a plain deterministic function of how close the
top viable candidates are to each other. Targeted parallel re-scoring via
LangGraph's Send API is a HIGH-VALUE-tier addition; this CORE build only
records complexity_score / spawned_workers as the extension point the
Send-based spawner will hook into later.
"""

from __future__ import annotations

from aegis_contracts import DispatchState, RejectionReason, TimingEntry
from aegis_contracts.timing import clock

SPAWN_THRESHOLD = 0.5


def _reject(candidate, triage) -> RejectionReason | None:
    if triage.requires_als and candidate.ambulance.capability != "ALS":
        return RejectionReason(
            reason_code="ALS_REQUIRED",
            human_text=f"{candidate.ambulance.id} (BLS, {candidate.ambulance_eta_minutes:.1f} min) rejected — ALS required.",
        )
    if triage.required_hospital_specialty and triage.required_hospital_specialty not in candidate.hospital.specialties:
        return RejectionReason(
            reason_code="SPECIALTY_REQUIRED",
            human_text=(
                f"{candidate.hospital.id} rejected — {triage.required_hospital_specialty} capability required."
            ),
        )
    if candidate.hospital.status != "OPEN":
        return RejectionReason(reason_code="HOSPITAL_DIVERSION", human_text=f"{candidate.hospital.id} is on diversion.")
    if candidate.hospital.bed_count <= 0:
        return RejectionReason(reason_code="NO_BEDS", human_text=f"{candidate.hospital.id} has no open beds.")
    return None


def _complexity_score(viable_scores: list[float]) -> float:
    if len(viable_scores) < 2:
        return 0.0
    best, second = sorted(viable_scores)[:2]
    if best == 0:
        return 0.0
    gap_ratio = (second - best) / best
    # Close scores (near-ties) are "complex" -> score closer to 1.
    return max(0.0, min(1.0, 1.0 - gap_ratio))


def rank_assignments(state: DispatchState) -> dict:
    start = clock()
    triage = state.triage
    scored_candidates = []
    for candidate in state.candidates:
        rejection = _reject(candidate, triage)
        if rejection:
            scored_candidates.append(candidate.model_copy(update={"rejected": True, "rejection": rejection}))
            continue
        score = (candidate.ambulance_eta_minutes or 0) + (candidate.hospital_eta_minutes or 0)
        scored_candidates.append(candidate.model_copy(update={"score": score, "rejected": False}))

    viable = [c for c in scored_candidates if not c.rejected]
    complexity_score = _complexity_score([c.score for c in viable])
    spawned_workers = 1 if complexity_score >= SPAWN_THRESHOLD else 0

    selected = min(viable, key=lambda c: c.score) if viable else None

    entry = TimingEntry(step="rank_assignments", start=start, end=clock())
    return {
        "candidates": scored_candidates,
        "selected": selected,
        "complexity_score": complexity_score,
        "spawned_workers": spawned_workers,
        "timing_log": state.timing_log + [entry],
    }
