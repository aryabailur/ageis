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
  const available = fleet?.ambulances.filter((a) => a.status === "AVAILABLE").length ?? null;
  const active = current && current.status !== "COMPLETED" && current.status !== "FAILED" ? 1 : 0;
  const isLive = current !== null && current.status !== "COMPLETED" && current.status !== "FAILED";
  // Real signal, not decorative: the share of calls this session that
  // reached DISPATCHED/COMPLETED without ever hitting AWAITING_REVIEW.
  const autonomyPct = callsHandled > 0 ? Math.round((callsAutonomous / callsHandled) * 100) : null;

  return (
    <header className="command-header">
      <div className="command-header-top">
        <div className="command-header-brand">
          <span className={`live-dot ${isLive ? "live-dot-active" : ""}`} />
          <span className="brand-name">AEGIS</span>
          <span className="brand-sub">AI-assisted 911 dispatch</span>
        </div>
        <div className="command-header-stats">
          {available !== null && <span className="stat-chip stat-chip-success" title="Ambulances free to take a new call right now">{available} ambulances free</span>}
          <span className={`stat-chip ${active ? "stat-chip-warning" : "stat-chip-muted"}`} title="Calls currently being processed">{active} call{active === 1 ? "" : "s"} in progress</span>
          {autonomyPct !== null && (
            <span className="stat-chip stat-chip-info" title="Share of calls this session that AEGIS handled start-to-finish with no human review needed">
              {autonomyPct}% handled without a human
            </span>
          )}
          <span className="stat-chip stat-chip-clock">{clock}</span>
        </div>
      </div>
      <p className="command-header-tagline">
        Every 911 call is triaged, matched to the best ambulance and hospital, and dispatched automatically —
        a human only steps in when AEGIS flags something it isn't confident about.
      </p>
    </header>
  );
}
