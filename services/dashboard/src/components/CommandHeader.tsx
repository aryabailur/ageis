import { useEffect, useState } from "react";
import type { DispatchState, FleetSnapshot } from "../types";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString("en-US", { hour12: false });
}

/** Response timer for the header: once a call reaches a terminal status,
 * shows the backend's own timing_log duration (call received -> dispatch
 * confirmed) -- the same figure TimingBreakdown/SurvivalMeter derive
 * elsewhere. Purely derived from data already on DispatchState; no new
 * field, no fabricated in-flight tick (timing_log entries use
 * time.monotonic(), not a wall-clock start comparable to Date.now()). */
function useResponseTimer(current: DispatchState | null): string | null {
  const isTerminal = current !== null && ["COMPLETED", "DISPATCHED", "FAILED"].includes(current.status);
  if (!current || !isTerminal) return null;

  const startEntry = current.timing_log.find((e) => e.step === "ingest_call");
  const lastEntry = current.timing_log[current.timing_log.length - 1];
  if (!startEntry || lastEntry?.end == null) return null;

  const seconds = lastEntry.end - startEntry.start;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CommandHeader({
  fleet,
  current,
  callsHandled,
  callsAutonomous,
}: {
  fleet: FleetSnapshot | null;
  current: DispatchState | null;
  callsHandled: number;
  callsAutonomous: number;
}) {
  const clock = useClock();
  const responseTimer = useResponseTimer(current);
  const available = fleet?.ambulances.filter((a) => a.status === "AVAILABLE").length ?? null;
  const active = current && current.status !== "COMPLETED" && current.status !== "FAILED" ? 1 : 0;
  const isLive = current !== null && current.status !== "COMPLETED" && current.status !== "FAILED";
  // Real signal, not decorative: the share of calls this session that
  // reached DISPATCHED/COMPLETED without ever hitting AWAITING_REVIEW.
  const autonomyPct = callsHandled > 0 ? Math.round((callsAutonomous / callsHandled) * 100) : null;

  return (
    <header className="command-header">
      <div className="command-header-section command-header-left">
        <div className="brand-mark" aria-hidden="true">
          A
        </div>
        <div className="command-header-brand-text">
          <span className="brand-name">AEGIS</span>
          <span className="brand-sub">Emergency Intelligence Platform</span>
        </div>
      </div>

      <div className="command-header-section command-header-center">
        <span className={`live-indicator ${isLive ? "live-indicator-active" : ""}`}>
          <span className="live-dot" />
          {isLive ? "LIVE EMERGENCY" : "STANDBY"}
        </span>
        <span className="command-header-divider" />
        <span className="command-header-clock field-mono">{clock}</span>
        {responseTimer !== null && (
          <>
            <span className="command-header-divider" />
            <span className="command-header-timer field-mono" title="Time from call received to dispatch confirmed">
              {responseTimer}
            </span>
          </>
        )}
      </div>

      <div className="command-header-section command-header-right">
        {available !== null && (
          <span className="stat-chip stat-chip-success" title="Ambulances free to take a new call right now">
            {available} free
          </span>
        )}
        <span className={`stat-chip ${active ? "stat-chip-warning" : "stat-chip-muted"}`} title="Calls currently being processed">
          {active} call{active === 1 ? "" : "s"}
        </span>
        {autonomyPct !== null && (
          <span
            className="stat-chip stat-chip-info"
            title="Share of calls this session that AEGIS handled start-to-finish with no human review needed"
          >
            {autonomyPct}% autonomous
          </span>
        )}
        <button type="button" className="icon-btn" title="System health: nominal" aria-label="System health">
          <span className="system-health-dot" />
        </button>
        <button type="button" className="icon-btn" title="Notifications" aria-label="Notifications">
          🔔
        </button>
        <div className="user-avatar" aria-hidden="true">
          OP
        </div>
      </div>
    </header>
  );
}
