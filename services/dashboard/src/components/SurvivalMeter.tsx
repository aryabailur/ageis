import type { TimingEntry } from "../types";
import { NAIVE_DISPATCH_SECONDS, survivalAt } from "../survivalModel";

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
      <h2>Why speed matters</h2>
      <p className="muted panel-intro">
        For cardiac arrest, every minute without help lowers survival odds by roughly 10%. Here's what
        AEGIS's speed is actually worth.
      </p>
      <div className="survival-compare">
        <div className="survival-side">
          <div className="survival-label">AEGIS (this call)</div>
          <div className="survival-time">{aegisSeconds.toFixed(1)}s to lock a dispatch</div>
          <div className="survival-bar-track">
            <div className="survival-bar survival-bar-aegis" style={{ width: `${aegisSurvival * 100}%` }} />
          </div>
          <div className="survival-value">{(aegisSurvival * 100).toFixed(1)}% estimated survival odds</div>
        </div>
        <div className="survival-side">
          <div className="survival-label">Typical human dispatcher</div>
          <div className="survival-time">{NAIVE_DISPATCH_SECONDS}s to lock a dispatch (modeled)</div>
          <div className="survival-bar-track">
            <div className="survival-bar survival-bar-naive" style={{ width: `${naiveSurvival * 100}%` }} />
          </div>
          <div className="survival-value">{(naiveSurvival * 100).toFixed(1)}% estimated survival odds</div>
        </div>
      </div>
      <div className="survival-gap">
        AEGIS's speed is worth an estimated <strong>+{gapPoints.toFixed(1)} percentage points</strong> of survival odds
      </div>
      <p className="muted survival-footnote">
        Modeled estimate, per published OHCA decay (~10%/min; literature range 5–12%/min). Illustrative
        baseline, not a clinical prediction.
      </p>
    </div>
  );
}
