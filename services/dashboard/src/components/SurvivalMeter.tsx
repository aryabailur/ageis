import type { TimingEntry } from "../types";

/**
 * Modeled estimate, per published OHCA survival decay: S(t) = S0 x (1-r)^t
 * with r = 0.10/min for cardiac arrest (headline figure; literature range
 * ~5-12%/min) and an illustrative S0 baseline. Frontend-derived view only,
 * computed from timing_log -- deliberately NOT part of DispatchState, so no
 * model math ever lives in the protocol.
 */

const DECAY_PER_MINUTE = 0.1;
const S0 = 0.9; // illustrative survival baseline at t=0
const NAIVE_DISPATCH_SECONDS = 90; // modeled manual nearest-to-nearest dispatch time

function survivalAt(seconds: number): number {
  return S0 * Math.pow(1 - DECAY_PER_MINUTE, seconds / 60);
}

export function SurvivalMeter({
  timingLog,
  chiefComplaint,
}: {
  timingLog: TimingEntry[];
  chiefComplaint: string;
}) {
  if (chiefComplaint !== "CARDIAC") {
    return null; // decay model is cardiac-specific; don't fake it for other complaints
  }

  const aegisSeconds =
    timingLog.reduce((sum, entry) => sum + (entry.end === null ? 0 : entry.end - entry.start), 0);
  const aegisSurvival = survivalAt(aegisSeconds);
  const naiveSurvival = survivalAt(NAIVE_DISPATCH_SECONDS);
  const gapPoints = (aegisSurvival - naiveSurvival) * 100;

  return (
    <div className="card">
      <h2>Survival Impact Meter</h2>
      <div className="survival-compare">
        <div className="survival-side">
          <div className="survival-label">AEGIS dispatch lock</div>
          <div className="survival-time">{aegisSeconds.toFixed(1)}s</div>
          <div className="survival-bar-track">
            <div className="survival-bar survival-bar-aegis" style={{ width: `${aegisSurvival * 100}%` }} />
          </div>
          <div className="survival-value">{(aegisSurvival * 100).toFixed(1)}% modeled survival</div>
        </div>
        <div className="survival-side">
          <div className="survival-label">Naive manual dispatch (modeled)</div>
          <div className="survival-time">{NAIVE_DISPATCH_SECONDS}s</div>
          <div className="survival-bar-track">
            <div className="survival-bar survival-bar-naive" style={{ width: `${naiveSurvival * 100}%` }} />
          </div>
          <div className="survival-value">{(naiveSurvival * 100).toFixed(1)}% modeled survival</div>
        </div>
      </div>
      <div className="survival-gap">
        Survival gap: <strong>+{gapPoints.toFixed(1)} percentage points</strong>
      </div>
      <p className="muted survival-footnote">
        Modeled estimate, per published OHCA decay (~10%/min; literature range 5–12%/min). Illustrative
        baseline, not a clinical prediction.
      </p>
    </div>
  );
}
