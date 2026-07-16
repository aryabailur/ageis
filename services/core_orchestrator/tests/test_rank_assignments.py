"""Deterministic, no-network tests for the scoring/spawn-decision/finalize
split -- covers exactly what test_clean_cardiac_path.py's live run can't
guarantee run-to-run (whether SPAWN_THRESHOLD actually gets crossed).
"""

from __future__ import annotations

from langgraph.types import Send

from aegis_contracts import Ambulance, CandidateAssignment, DispatchState, Hospital, Priority, TriageResult
from app.nodes import gates
from app.nodes.rank_assignments import finalize_ranking, rank_assignments, reverify_candidate

TRIAGE_ALS_CARDIAC = TriageResult(
    priority=Priority.P1, rule_ids=["RULE_X"], requires_als=True, required_hospital_specialty="cardiac"
)


def _candidate(amb_id, hosp_id, amb_eta, hosp_eta, capability="ALS", specialties=("cardiac",)):
    return CandidateAssignment(
        ambulance=Ambulance(id=amb_id, lat=0, lng=0, capability=capability),
        hospital=Hospital(id=hosp_id, lat=0, lng=0, bed_count=3, specialties=list(specialties)),
        ambulance_eta_minutes=amb_eta,
        hospital_eta_minutes=hosp_eta,
    )


def test_near_tied_candidates_cross_spawn_threshold_and_fan_out_a_send_per_viable_candidate():
    state = DispatchState(
        call_id="c1",
        triage=TRIAGE_ALS_CARDIAC,
        candidates=[_candidate("unit-1", "hosp-a", 2.0, 3.0), _candidate("unit-2", "hosp-a", 2.1, 3.0)],
    )
    update = rank_assignments(state)
    assert update["complexity_score"] >= 0.5
    assert update["spawned_workers"] == 2

    state_after_rank = state.model_copy(update=update)
    routed = gates.spawn_reverification(state_after_rank)
    assert isinstance(routed, list)
    assert len(routed) == 2
    assert all(isinstance(s, Send) and s.node == "reverify_candidate" for s in routed)


def test_clearly_better_candidate_does_not_spawn_anything():
    state = DispatchState(
        call_id="c2",
        triage=TRIAGE_ALS_CARDIAC,
        candidates=[_candidate("unit-1", "hosp-a", 2.0, 3.0), _candidate("unit-2", "hosp-a", 20.0, 30.0)],
    )
    update = rank_assignments(state)
    assert update["complexity_score"] < 0.5
    assert update["spawned_workers"] == 0

    state_after_rank = state.model_copy(update=update)
    assert gates.spawn_reverification(state_after_rank) == "finalize_ranking"


def test_rejected_candidates_are_never_sent_to_reverify():
    state = DispatchState(
        call_id="c3",
        triage=TRIAGE_ALS_CARDIAC,
        candidates=[
            _candidate("unit-1", "hosp-a", 2.0, 3.0),
            _candidate("bls-unit", "hosp-a", 1.0, 1.0, capability="BLS"),  # rejected: ALS required
        ],
    )
    update = rank_assignments(state)
    scored = update["candidates"]
    assert scored[1].rejected is True

    state_after_rank = state.model_copy(update=update)
    routed = gates.spawn_reverification(state_after_rank)
    if isinstance(routed, list):
        sent_candidate_ids = {s.arg["candidate"]["ambulance"]["id"] for s in routed}
        assert "bls-unit" not in sent_candidate_ids


def test_finalize_ranking_uses_reverified_pool_when_spawned_else_initial_pool():
    initial_scored = [
        _candidate("unit-1", "hosp-a", 2.0, 3.0).model_copy(update={"score": 5.0}),
        _candidate("unit-2", "hosp-a", 2.1, 3.0).model_copy(update={"score": 5.1}),
    ]
    state_no_spawn = DispatchState(call_id="c4", triage=TRIAGE_ALS_CARDIAC, candidates=initial_scored, spawned_workers=0)
    result = finalize_ranking(state_no_spawn)
    assert result["selected"].ambulance.id == "unit-1"

    reverified = [
        _candidate("unit-1", "hosp-a", 2.0, 3.0).model_copy(update={"score": 99.0}),
        _candidate("unit-2", "hosp-a", 2.1, 3.0).model_copy(update={"score": 1.0}),
    ]
    state_spawned = DispatchState(
        call_id="c5",
        triage=TRIAGE_ALS_CARDIAC,
        candidates=initial_scored,
        reverified_candidates=reverified,
        spawned_workers=2,
    )
    result = finalize_ranking(state_spawned)
    assert result["selected"].ambulance.id == "unit-2"


def test_reverify_candidate_worker_recomputes_independently_from_payload():
    candidate = _candidate("unit-1", "hosp-a", 2.0, 3.0)
    payload = {"candidate": candidate.model_dump(), "triage": TRIAGE_ALS_CARDIAC.model_dump()}
    result = reverify_candidate(payload)
    assert len(result["reverified_candidates"]) == 1
    reverified = result["reverified_candidates"][0]
    assert reverified.rejected is False
    assert reverified.score == 5.0
