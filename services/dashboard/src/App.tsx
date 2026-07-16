import { useState } from "react";
import { dispatch, DispatchRequest } from "./api";
import type { DispatchState } from "./types";
import { StatusBadge } from "./components/StatusBadge";
import { DispatchForm } from "./components/DispatchForm";
import { IncidentCard } from "./components/IncidentCard";
import { TriageCard } from "./components/TriageCard";
import { CandidateList } from "./components/CandidateList";
import { ReservationCard } from "./components/ReservationCard";
import { TimingBreakdown } from "./components/TimingBreakdown";
import { ComplexityPanel } from "./components/ComplexityPanel";

export default function App() {
  const [state, setState] = useState<DispatchState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDispatch(request: DispatchRequest) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await dispatch(request);
      setState(result);
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
          {state.review_reason && (
            <div className="card card-warning">Escalated to human review: {state.review_reason}</div>
          )}
          {state.failure_reason && <div className="card card-error">Failed: {state.failure_reason}</div>}

          <div className="grid-2">
            {state.incident && <IncidentCard incident={state.incident} />}
            {state.triage && <TriageCard triage={state.triage} />}
          </div>

          <CandidateList candidates={state.candidates} selected={state.selected} />

          <div className="grid-2">
            <ReservationCard reservation={state.reservation} />
            <ComplexityPanel complexityScore={state.complexity_score} spawnedWorkers={state.spawned_workers} />
          </div>

          <TimingBreakdown timingLog={state.timing_log} />
        </>
      )}
    </div>
  );
}
