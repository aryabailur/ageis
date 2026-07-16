import { useState } from "react";
import { dispatch, DispatchRequest, fetchNaiveBaseline } from "./api";
import type { DispatchState, NaiveBaseline } from "./types";
import { StatusBadge } from "./components/StatusBadge";
import { DispatchForm } from "./components/DispatchForm";
import { IncidentCard } from "./components/IncidentCard";
import { TriageCard } from "./components/TriageCard";
import { CoachingPanel } from "./components/CoachingPanel";
import { CandidateList } from "./components/CandidateList";
import { ReservationCard } from "./components/ReservationCard";
import { TimingBreakdown } from "./components/TimingBreakdown";
import { ComplexityPanel } from "./components/ComplexityPanel";
import { SurvivalMeter } from "./components/SurvivalMeter";
import { BaselineComparison } from "./components/BaselineComparison";
import { DiversionControl } from "./components/DiversionControl";

export default function App() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [baseline, setBaseline] = useState<NaiveBaseline | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDispatch(request: DispatchRequest) {
    setIsLoading(true);
    setError(null);
    setBaseline(null);
    try {
      // Baseline is fetched in parallel with the dispatch itself -- it's a
      // read-only comparison view and must never delay the real call.
      const baselinePromise = fetchNaiveBaseline(request.caller_lat, request.caller_lng).catch(() => null);
      const result = await dispatch(request);
      setState(result);
      setBaseline(await baselinePromise);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>AEGIS — Protocol-Gated Emergency Dispatch</h1>
        {state && <StatusBadge status={state.status} />}
      </header>

      <DispatchForm onSubmit={handleDispatch} isLoading={isLoading} />

      {error && <div className="card card-error">{error}</div>}

      {state && (
        <>
          {state.prearrival && <CoachingPanel prearrival={state.prearrival} />}

          {state.review_reason && (
            <div className="card card-warning">Escalated to human review: {state.review_reason}</div>
          )}
          {state.failure_reason && <div className="card card-error">Failed: {state.failure_reason}</div>}
          {state.replan_count > 0 && (
            <div className="card card-warning">
              Replanned {state.replan_count}× — a selected hospital went to diversion mid-flight and AEGIS
              automatically re-picked a valid one. No human touched it.
            </div>
          )}

          <div className="grid-2">
            {state.incident && <IncidentCard incident={state.incident} />}
            {state.triage && <TriageCard triage={state.triage} />}
          </div>

          {state.incident && (
            <SurvivalMeter timingLog={state.timing_log} chiefComplaint={state.incident.chief_complaint} />
          )}

          {baseline && state.selected && state.triage && (
            <BaselineComparison baseline={baseline} selected={state.selected} triage={state.triage} />
          )}

          <CandidateList candidates={state.candidates} selected={state.selected} />

          <div className="grid-2">
            <ReservationCard reservation={state.reservation} />
            <ComplexityPanel
              complexityScore={state.complexity_score}
              spawnedWorkers={state.spawned_workers}
              reverifiedCandidates={state.reverified_candidates}
            />
          </div>

          <TimingBreakdown timingLog={state.timing_log} />
        </>
      )}

      <DiversionControl />
    </div>
  );
}
