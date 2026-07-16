import { useState } from "react";
import { setHospitalStatus } from "../api";

const DEMO_HOSPITALS = ["hosp-general", "hosp-cardiac-center", "hosp-trauma"];

/**
 * Demo control for the diversion -> replan beat: flips a hospital's live
 * status in Supabase through the orchestrator's admin endpoint. Flip the
 * selected hospital between reservation and dispatch and the workflow's
 * live recheck catches it and replans automatically.
 */
export function DiversionControl() {
  const [hospitalId, setHospitalId] = useState(DEMO_HOSPITALS[1]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function flip(status: "OPEN" | "DIVERSION") {
    setBusy(true);
    setMessage(null);
    try {
      const hospital = await setHospitalStatus(hospitalId, status);
      setMessage(`${hospital.id} is now ${hospital.status}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-admin">
      <h2>Demo controls — hospital diversion</h2>
      <div className="diversion-row">
        <select value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
          {DEMO_HOSPITALS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button type="button" className="btn-small btn-danger" disabled={busy} onClick={() => flip("DIVERSION")}>
          Flip to DIVERSION
        </button>
        <button type="button" className="btn-small" disabled={busy} onClick={() => flip("OPEN")}>
          Restore to OPEN
        </button>
      </div>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
