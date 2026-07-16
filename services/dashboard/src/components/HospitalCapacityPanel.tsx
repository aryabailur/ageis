import { useState } from "react";
import { setHospitalStatus } from "../api";
import type { FleetSnapshot, Hospital } from "../types";
import { hospitalDisplayName, specialtyLabel } from "../glossary";

interface Props {
  fleet: FleetSnapshot | null;
  selectedHospitalId: string | null;
  onStatusChanged: (hospital: Hospital) => void;
}

/**
 * Real hospital status, real bed counts, and a real admin action per row
 * (POST /admin/hospitals/{id}/status) -- the diversion -> replan demo beat
 * folded into the same panel instead of a separate "demo controls" card,
 * since it's a first-class capability of this view, not a side gimmick.
 */
export function HospitalCapacityPanel({ fleet, selectedHospitalId, onStatusChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hospitals = fleet?.hospitals ?? [];

  async function flip(hospital: Hospital) {
    setBusyId(hospital.id);
    setError(null);
    try {
      const next = hospital.status === "OPEN" ? "DIVERSION" : "OPEN";
      const updated = await setHospitalStatus(hospital.id, next);
      onStatusChanged(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <h2>Hospital capacity</h2>
      <p className="muted panel-intro">
        Live bed counts and specialties. "Diversion" means a hospital has told dispatchers to stop
        sending patients — try it below to watch AEGIS re-route mid-call.
      </p>
      {hospitals.length === 0 ? (
        <p className="muted">No fleet data loaded yet.</p>
      ) : (
        <ul className="capacity-list">
          {hospitals.map((h) => {
            const isSelected = h.id === selectedHospitalId;
            return (
              <li key={h.id} className={`capacity-row ${isSelected ? "capacity-row-selected" : ""}`}>
                <div className="capacity-row-main">
                  <span className="capacity-name">
                    {hospitalDisplayName(h.id)}
                    {isSelected && <span className="pill pill-success capacity-selected-pill">selected for this call</span>}
                  </span>
                  <span className={`pill ${h.status === "OPEN" ? "pill-success" : "pill-error"}`}>
                    {h.status === "OPEN" ? `${h.bed_count} beds open` : "on diversion"}
                  </span>
                </div>
                <div className="capacity-row-meta">
                  <span className="muted">{h.specialties.map(specialtyLabel).join(" · ")}</span>
                  <button
                    type="button"
                    className="btn-small btn-inline"
                    disabled={busyId === h.id}
                    onClick={() => flip(h)}
                  >
                    {h.status === "OPEN" ? "Simulate going on diversion" : "Restore to open"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="muted card-error-inline">{error}</p>}
    </div>
  );
}
