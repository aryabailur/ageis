import { useEffect, useState } from "react";
import type { DispatchState } from "../types";
import { survivalAt } from "../survivalModel";

const SEV_CLASS: Record<string, string> = {
  P1: "sev-badge sev-badge-1",
  P2: "sev-badge sev-badge-2",
  P3: "sev-badge sev-badge-3",
  UNKNOWN: "sev-badge sev-badge-muted",
};

/**
 * Live survival clock: ticks against real wall-clock elapsed time from
 * when this browser tab first saw the call until reserve_ambulance
 * completes (the point a unit is actually committed), then freezes using
 * the backend's own timing_log duration -- SurvivalMeter below takes over
 * for the final AEGIS-vs-naive comparison once the run finishes. Only
 * rendered for cardiac chief complaints, matching SurvivalMeter's own
 * restriction (the decay model is cardiac-specific).
 */
export function IncidentIntakePanel({ state }: { state: DispatchState }) {
  const incident = state.incident;
  const wallClockStart = useWallClockStart(state.call_id);
  const [now, setNow] = useState(() => Date.now());
  const lockedEntry = state.timing_log.find((e) => e.step === "reserve_ambulance" && e.end != null);
  const startEntry = state.timing_log.find((e) => e.step === "ingest_call");
  const isCardiac = incident?.chief_complaint === "CARDIAC";

  useEffect(() => {
    if (!isCardiac || lockedEntry) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [isCardiac, lockedEntry]);

  let survivalPct: number | null = null;
  let elapsedSeconds: number | null = null;
  if (isCardiac && startEntry) {
    if (lockedEntry) {
      elapsedSeconds = lockedEntry.end! - startEntry.start;
    } else if (wallClockStart) {
      elapsedSeconds = (now - wallClockStart) / 1000;
    }
    if (elapsedSeconds !== null) survivalPct = survivalAt(elapsedSeconds) * 100;
  }

  return (
    <div className="card intake-card">
      <div className="intake-card-header">
        <h2>What the caller said</h2>
        {state.triage && (
          <span className={SEV_CLASS[state.triage.priority]} title="Severity level AEGIS assigned to this call">
            {state.triage.priority === "UNKNOWN" ? "UNCLEAR" : `SEV ${state.triage.priority.replace("P", "")}`}
          </span>
        )}
      </div>
      <blockquote className="intake-transcript">"{incident?.raw_transcript ?? state.raw_transcript}"</blockquote>

      {survivalPct !== null && (
        <div className="intake-survival">
          <span className="intake-survival-label">Estimated survival odds</span>
          <span className={`intake-survival-pct ${survivalPct < 50 ? "intake-survival-pct-hot" : ""}`}>
            {survivalPct.toFixed(0)}%
          </span>
          <span className="muted intake-survival-note">
            {lockedEntry ? "locked in at dispatch — every second before this mattered" : "dropping ~10%/min until a unit is dispatched"}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Anchors "now" to the moment this browser tab first saw the call, since
 * the backend's timing_log uses time.monotonic() (not comparable across
 * process/machine boundaries) and no wall-clock start timestamp is part
 * of the locked DispatchState contract. Re-derives per call_id so a new
 * dispatch gets a fresh anchor instead of reusing a stale one.
 */
function useWallClockStart(callId: string): number | null {
  const [anchors] = useState(() => new Map<string, number>());
  if (!anchors.has(callId)) {
    anchors.set(callId, Date.now());
  }
  return anchors.get(callId) ?? null;
}
