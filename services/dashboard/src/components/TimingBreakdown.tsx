import type { TimingEntry } from "../types";
import { stepLabel } from "../glossary";

interface Row {
  step: string;
  durationMs: number | null;
}

/**
 * Compact horizontal step strip -- replaces the previous raw table with
 * a scannable, judge-friendly summary. Same timing_log data, no new
 * fields; the exact-ms numbers are still available via the step's
 * title attribute for anyone who wants them.
 */
export function TimingBreakdown({ timingLog }: { timingLog: TimingEntry[] }) {
  const rows: Row[] = timingLog.map((entry) => ({
    step: entry.step,
    durationMs: entry.end === null ? null : (entry.end - entry.start) * 1000,
  }));
  const totalMs = rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);

  return (
    <div className="card panel-timing">
      <div className="panel-header">
        <h2>Total response time</h2>
        <span className="timing-total-value">{totalMs.toFixed(0)} ms</span>
      </div>
      <div className="timing-strip">
        {rows.map((row, index) => (
          // Index in the key, not just step name: a replanned call
          // legitimately re-runs validate_proposal/reserve_ambulance/
          // validate_reservation a second time, so step name alone
          // isn't a unique identity for this chronological log.
          <div
            key={`${row.step}-${index}`}
            className="timing-strip-step"
            title={row.durationMs === null ? undefined : `${row.durationMs.toFixed(1)} ms`}
          >
            <span className="timing-strip-dot" />
            <span className="timing-strip-label">{stepLabel(row.step)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
