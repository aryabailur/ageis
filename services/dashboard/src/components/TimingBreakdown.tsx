import type { TimingEntry } from "../types";

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
      <h2>Timing breakdown</h2>
      <div className="timing-total">
        Total dispatch time: <strong>{totalMs.toFixed(1)} ms</strong>
      </div>
      <table className="timing-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.step}>
              <td className="timing-step">{row.step}</td>
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
