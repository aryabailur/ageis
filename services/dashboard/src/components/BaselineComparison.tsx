import type { CandidateAssignment, NaiveBaseline, TriageResult } from "../types";
import { ambulanceDisplayName, hospitalDisplayName, specialtyLabel } from "../glossary";

/**
 * The quantified "why AEGIS beats nearest-to-nearest" view: side by side,
 * what a constraint-blind dispatcher would have picked (deliberately wrong
 * on the seeded demo data -- BLS unit, non-cardiac hospital) vs what AEGIS
 * actually locked, with the specific constraint each naive pick violates.
 * Rendered as a compact two-column comparison, not a table.
 */
export function BaselineComparison({
  baseline,
  selected,
  triage,
}: {
  baseline: NaiveBaseline;
  selected: CandidateAssignment;
  triage: TriageResult;
}) {
  const ambulanceWrong = triage.requires_als && baseline.ambulance.capability !== "ALS";
  const hospitalWrong =
    triage.required_hospital_specialty !== null &&
    !baseline.hospital.specialties.includes(triage.required_hospital_specialty);

  return (
    <div className="card panel-baseline">
      <div className="panel-header">
        <h2>Naive dispatch vs. AEGIS</h2>
      </div>
      <p className="muted panel-intro">
        "Just send the closest unit" is how naive dispatch works. Here's what that would have picked for this
        call, versus what AEGIS actually locked in.
      </p>
      <div className="baseline-compare-grid">
        <div className="baseline-col baseline-col-naive">
          <span className="baseline-col-title">Closest-only (naive)</span>
          <div className="baseline-row">
            <span className="baseline-row-label">Ambulance</span>
            <span className={ambulanceWrong ? "baseline-wrong" : ""}>
              {ambulanceDisplayName(baseline.ambulance.id)} ({baseline.ambulance.capability})
            </span>
            {ambulanceWrong && <span className="baseline-why">✕ no paramedic crew — wrong level of care</span>}
          </div>
          <div className="baseline-row">
            <span className="baseline-row-label">Hospital</span>
            <span className={hospitalWrong ? "baseline-wrong" : ""}>{hospitalDisplayName(baseline.hospital.id)}</span>
            {hospitalWrong && (
              <span className="baseline-why">
                ✕ can't treat {specialtyLabel(triage.required_hospital_specialty).toLowerCase()} cases
              </span>
            )}
          </div>
        </div>
        <div className="baseline-col baseline-col-aegis">
          <span className="baseline-col-title">AEGIS</span>
          <div className="baseline-row">
            <span className="baseline-row-label">Ambulance</span>
            <span>
              {ambulanceDisplayName(selected.ambulance.id)} ({selected.ambulance.capability})
            </span>
            <span className="baseline-why baseline-why-ok">✓ has the paramedic crew this case needs</span>
          </div>
          <div className="baseline-row">
            <span className="baseline-row-label">Hospital</span>
            <span>{hospitalDisplayName(selected.hospital.id)}</span>
            <span className="baseline-why baseline-why-ok">
              ✓ {selected.hospital.bed_count} beds open, treats {specialtyLabel(triage.required_hospital_specialty).toLowerCase()}
            </span>
          </div>
        </div>
      </div>
      <p className="muted field-inline-note-small">
        Naive pick source: <code>{baseline.data_source}</code> — the nearest unit and hospital, with no check
        for capability, capacity, or whether they're even open.
      </p>
    </div>
  );
}
