import type { TimingEntry } from "../types";
import { NAIVE_DISPATCH_SECONDS, survivalAt } from "../survivalModel";
import { CircularGauge } from "./CircularGauge";

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

  const log = timingLog ?? [];
  const aegisSeconds = log.reduce((sum, entry) => sum + (entry.end === null ? 0 : entry.end - entry.start), 0);
  const aegisSurvival = survivalAt(aegisSeconds);
  const naiveSurvival = survivalAt(NAIVE_DISPATCH_SECONDS);
  const gapPoints = (aegisSurvival - naiveSurvival) * 100;
  const timeSavedSeconds = Math.max(0, NAIVE_DISPATCH_SECONDS - aegisSeconds);
  const gaugeTone = aegisSurvival >= 0.7 ? "success" : aegisSurvival >= 0.4 ? "warning" : "error";

  return (
    <div className="card panel-survival">
      <div className="panel-header">
        <h2>Estimated survival</h2>
      </div>
      <p className="muted panel-intro">
        For cardiac arrest, every minute without help lowers survival odds by roughly 10%. Here's what AEGIS's
        speed is actually worth.
      </p>
      <div className="survival-gauge-row">
        <CircularGauge percent={aegisSurvival * 100} label="Survival" sublabel="this call" tone={gaugeTone} />
        <div className="survival-stat-col">
          <div className="survival-stat">
            <span className="survival-stat-value">+{gapPoints.toFixed(0)}pt</span>
            <span className="survival-stat-label">Response improvement</span>
          </div>
          <div className="survival-stat">
            <span className="survival-stat-value">{timeSavedSeconds.toFixed(0)}s</span>
            <span className="survival-stat-label">Time saved vs. human dispatcher</span>
          </div>
          <div className="survival-stat">
            <span className="survival-stat-value">{aegisSeconds.toFixed(1)}s</span>
            <span className="survival-stat-label">AEGIS dispatch time</span>
          </div>
        </div>
      </div>
      <p className="muted survival-footnote">
        Modeled estimate, per published OHCA decay (~10%/min; literature range 5–12%/min) — vs. a{" "}
        {NAIVE_DISPATCH_SECONDS}s typical-human-dispatcher baseline ({(naiveSurvival * 100).toFixed(0)}% survival).
        Illustrative, not a clinical prediction.
      </p>
    </div>
  );
}
