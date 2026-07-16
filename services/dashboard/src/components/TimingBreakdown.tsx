import type { TimingEntry } from "../types";
import { stepLabel } from "../glossary";

interface Row {
  step: string;
  durationMs: number | null;
}

export function TimingBreakdown({ timingLog }: { timingLog: TimingEntry[] }) {
  const rows: Row[] = timingLog.map((entry) => ({
    step: entry.step,
    durationMs: entry.end === null ? null : (entry.end - entry.start) * 1000,
  }));
  const totalMs = rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
  const maxMs = Math.max(1, ...rows.map((row) => row.durationMs ?? 0));

  return (
    <div className="card">
      <h2>Every step AEGIS took</h2>
      <div className="timing-total">
        Total time from call received to dispatch confirmed: <strong>{totalMs.toFixed(1)} ms</strong>
      </div>
      <table className="timing-table">
        <tbody>
          {rows.map((row, index) => (
            // Index in the key, not just step name: a replanned call
            // legitimately re-runs validate_proposal/reserve_ambulance/
            // validate_reservation a second time, so step name alone
            // isn't a unique identity for this chronological log.
            <tr key={`${row.step}-${index}`}>
              <td className="timing-step">
                {stepLabel(row.step)}
                <span className="timing-step-code">{row.step}</span>
              </td>
              <td className="timing-bar-cell">
                <div className="timing-bar" style={{ width: `${((row.durationMs ?? 0) / maxMs) * 100}%` }} />
              </td>
              <td className="timing-value">{row.durationMs === null ? "—" : `${row.durationMs.toFixed(1)} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
