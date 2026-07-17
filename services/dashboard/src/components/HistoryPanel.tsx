/**
 * HistoryPanel — History tab for the AEGIS dashboard.
 *
 * Shows a paginated, filterable table of every logged dispatch run.
 * Clicking a row opens a slide-out replay drawer that renders the stored
 * DispatchState snapshot using the same sub-components the Live tab uses —
 * no new rendering logic needed.
 *
 * Data flow
 * ---------
 *   mount / filter change → fetchLogs() → rows table
 *   row click             → fetchLog()  → drawer with full snapshot
 *
 * The component is self-contained: all state is local (useState), no Zustand
 * store or router needed, consistent with the minimal view-toggling pattern
 * the rest of App.tsx uses.
 */

import { useEffect, useRef, useState } from "react";
import type { LogDetail, LogFilters, LogListItem } from "../api";
import { fetchLog, fetchLogs } from "../api";
import type { DispatchStatus } from "../types";
import { StatusBadge } from "./StatusBadge";
import { TriageCard } from "./TriageCard";
import { CandidateList } from "./CandidateList";
import { ReservationCard } from "./ReservationCard";
import { TimingBreakdown } from "./TimingBreakdown";
import { IncidentIntakePanel } from "./IncidentIntakePanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function priorityBadgeClass(priority: string | null): string {
  if (!priority) return "badge";
  if (priority === "P1") return "badge badge-error";
  if (priority === "P2") return "badge badge-warning";
  if (priority === "P3") return "badge badge-success";
  return "badge";
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    DISPATCHED: "badge badge-success",
    COMPLETED: "badge badge-success",
    AWAITING_REVIEW: "badge badge-warning",
    FAILED: "badge badge-error",
    IN_PROGRESS: "badge badge-info",
  };
  return map[status] ?? "badge";
}

const STATUS_OPTIONS = ["", "DISPATCHED", "COMPLETED", "AWAITING_REVIEW", "FAILED"];
const PRIORITY_OPTIONS = ["", "P1", "P2", "P3", "UNKNOWN"];

// ---------------------------------------------------------------------------
// Replay Drawer
// ---------------------------------------------------------------------------

interface ReplayDrawerProps {
  detail: LogDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

function ReplayDrawer({ detail, loading, error, onClose }: ReplayDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Small delay so the click that opened the drawer doesn't immediately close it
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const snapshot = detail?.state_snapshot ?? null;

  return (
    <div className="history-drawer-backdrop">
      <div className="history-drawer card" ref={drawerRef} role="dialog" aria-modal="true" aria-label="Call replay">
        <div className="history-drawer-header">
          <div>
            <h2 style={{ marginBottom: 2 }}>Call replay</h2>
            {detail && (
              <span className="history-drawer-meta">
                {detail.call_id} · {fmtTs(detail.completed_at)}
              </span>
            )}
          </div>
          <button id="history-drawer-close" className="icon-btn" onClick={onClose} aria-label="Close replay">
            ✕
          </button>
        </div>

        {loading && (
          <div className="history-drawer-placeholder">
            <span className="history-spinner" />
            <span>Loading snapshot…</span>
          </div>
        )}

        {error && (
          <div className="card card-error" style={{ marginTop: 0 }}>
            {error}
          </div>
        )}

        {snapshot && !loading && (
          <div className="history-drawer-body">
            {/* Status row */}
            <div className="history-drawer-status-row">
              <StatusBadge status={snapshot.status as DispatchStatus} />
              {snapshot.triage && (
                <span className={priorityBadgeClass(snapshot.triage.priority)}>
                  {snapshot.triage.priority}
                </span>
              )}
              {snapshot.replan_count > 0 && (
                <span className="pill pill-warning">self-corrected {snapshot.replan_count}×</span>
              )}
              {snapshot.failure_reason && (
                <span className="pill pill-error">{snapshot.failure_reason}</span>
              )}
            </div>

            {/* Raw transcript */}
            {snapshot.raw_transcript && (
              <div className="history-transcript-block">
                <span className="history-transcript-label">Transcript</span>
                <p className="history-transcript-text">{snapshot.raw_transcript}</p>
              </div>
            )}

            {/* Incident intake */}
            {snapshot.incident && <IncidentIntakePanel state={snapshot} />}

            {/* Triage */}
            {snapshot.triage && <TriageCard triage={snapshot.triage} />}

            {/* Candidates */}
            {snapshot.candidates.length > 0 && (
              <CandidateList candidates={snapshot.candidates} selected={snapshot.selected} />
            )}

            {/* Reservation */}
            {snapshot.reservation && <ReservationCard reservation={snapshot.reservation} />}

            {/* Timing */}
            {snapshot.timing_log.length > 0 && <TimingBreakdown timingLog={snapshot.timing_log} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  filters: LogFilters;
  onChange: (f: LogFilters) => void;
  onRefresh: () => void;
  loading: boolean;
}

function FilterBar({ filters, onChange, onRefresh, loading }: FilterBarProps) {
  return (
    <div className="history-filter-bar">
      <select
        id="history-filter-status"
        className="history-select"
        value={filters.status ?? ""}
        onChange={(e) => onChange({ ...filters, status: e.target.value || undefined, offset: 0 })}
        aria-label="Filter by status"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s || "All statuses"}
          </option>
        ))}
      </select>

      <select
        id="history-filter-priority"
        className="history-select"
        value={filters.priority ?? ""}
        onChange={(e) => onChange({ ...filters, priority: e.target.value || undefined, offset: 0 })}
        aria-label="Filter by priority"
      >
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {p || "All priorities"}
          </option>
        ))}
      </select>

      <button
        id="history-refresh-btn"
        className="btn btn-secondary"
        onClick={onRefresh}
        disabled={loading}
        aria-label="Refresh history"
      >
        {loading ? "Loading…" : "↻ Refresh"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HistoryPanel() {
  const [filters, setFilters] = useState<LogFilters>({ limit: 50, offset: 0 });
  const [rows, setRows] = useState<LogListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerDetail, setDrawerDetail] = useState<LogDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Fetch list
  const load = async (f: LogFilters) => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetchLogs(f);
      setRows(res.items);
      setTotal(res.count);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (f: LogFilters) => {
    setFilters(f);
    load(f);
  };

  const handleRefresh = () => load(filters);

  // Open drawer
  const openDrawer = async (item: LogListItem) => {
    setDrawerOpen(true);
    setDrawerDetail(null);
    setDrawerError(null);
    setDrawerLoading(true);
    try {
      const detail = await fetchLog(item.call_id);
      setDrawerDetail(detail);
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : "Failed to load call detail");
    } finally {
      setDrawerLoading(false);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setDrawerDetail(null);
    setDrawerError(null);
  };

  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 50;

  return (
    <div className="history-panel">
      <div className="panel-header" style={{ marginBottom: "var(--space-4)" }}>
        <h2>Dispatch history</h2>
        <span className="stat-chip stat-chip-muted">{total} call{total !== 1 ? "s" : ""} logged</span>
      </div>

      <FilterBar filters={filters} onChange={handleFilterChange} onRefresh={handleRefresh} loading={listLoading} />

      {listError && (
        <div className="card card-error" style={{ marginBottom: "var(--space-3)" }}>
          {listError}
        </div>
      )}

      {!listLoading && !listError && rows.length === 0 && (
        <div className="history-empty">
          <span>No dispatch logs yet. Submit a call to see it here.</span>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="history-table-wrapper">
            <table className="history-table" aria-label="Dispatch history table">
              <thead>
                <tr>
                  <th>Call ID</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Location</th>
                  <th>Completed</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="history-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`Replay call ${row.call_id}`}
                    onClick={() => openDrawer(row)}
                    onKeyDown={(e) => e.key === "Enter" && openDrawer(row)}
                  >
                    <td className="history-call-id">{row.call_id}</td>
                    <td>
                      <span className={statusBadgeClass(row.status)}>
                        {row.status.replace("_", " ")}
                      </span>
                    </td>
                    <td>
                      {row.priority ? (
                        <span className={priorityBadgeClass(row.priority)}>{row.priority}</span>
                      ) : (
                        <span className="history-null">—</span>
                      )}
                    </td>
                    <td className="history-coords">
                      {row.caller_lat != null && row.caller_lng != null
                        ? `${row.caller_lat.toFixed(3)}, ${row.caller_lng.toFixed(3)}`
                        : <span className="history-null">—</span>}
                    </td>
                    <td className="history-ts">{fmtTs(row.completed_at)}</td>
                    <td>
                      <button
                        id={`history-replay-${row.id}`}
                        className="btn btn-ghost btn-sm"
                        onClick={(e) => { e.stopPropagation(); openDrawer(row); }}
                        aria-label={`Replay call ${row.call_id}`}
                      >
                        Replay ›
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="history-pagination">
            <button
              id="history-prev-btn"
              className="btn btn-secondary btn-sm"
              disabled={offset === 0 || listLoading}
              onClick={() => handleFilterChange({ ...filters, offset: Math.max(0, offset - limit) })}
            >
              ← Prev
            </button>
            <span className="history-page-info">
              {offset + 1}–{Math.min(offset + rows.length, offset + limit)} of {total > 0 ? `${total}+` : "?"}
            </span>
            <button
              id="history-next-btn"
              className="btn btn-secondary btn-sm"
              disabled={rows.length < limit || listLoading}
              onClick={() => handleFilterChange({ ...filters, offset: offset + limit })}
            >
              Next →
            </button>
          </div>
        </>
      )}

      {drawerOpen && (
        <ReplayDrawer
          detail={drawerDetail}
          loading={drawerLoading}
          error={drawerError}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
