import type { CandidateAssignment, NaiveBaseline, TriageResult } from "../types";
import { ambulanceDisplayName, hospitalDisplayName, specialtyLabel } from "../glossary";

/**
 * The quantified "why AEGIS beats nearest-to-nearest" view: side by side,
 * what a constraint-blind dispatcher would have picked (deliberately wrong
 * on the seeded demo data -- BLS unit, non-cardiac hospital) vs what AEGIS
 * actually locked, with the specific constraint each naive pick violates.
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
    <div className="card">
      <h2>What a simpler dispatcher would have gotten wrong</h2>
      <p className="muted panel-intro">
        "Just send the closest unit" is how naive dispatch works. Here's what that would have picked
        for this call, versus what AEGIS actually locked in.
      </p>
      <table className="baseline-table">
        <thead>
          <tr>
            <th></th>
            <th>Closest-only (naive)</th>
            <th>AEGIS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="baseline-rowlabel">Ambulance</td>
            <td className={ambulanceWrong ? "baseline-wrong" : ""}>
              {ambulanceDisplayName(baseline.ambulance.id)} ({baseline.ambulance.capability})
              {ambulanceWrong && <div className="baseline-why">✕ no paramedic crew — wrong level of care</div>}
            </td>
            <td className="baseline-right">
              {ambulanceDisplayName(selected.ambulance.id)} ({selected.ambulance.capability})
              <div className="baseline-why baseline-why-ok">✓ has the paramedic crew this case needs</div>
            </td>
          </tr>
          <tr>
            <td className="baseline-rowlabel">Hospital</td>
            <td className={hospitalWrong ? "baseline-wrong" : ""}>
              {hospitalDisplayName(baseline.hospital.id)}
              {hospitalWrong && (
                <div className="baseline-why">✕ can't treat {specialtyLabel(triage.required_hospital_specialty).toLowerCase()} cases</div>
              )}
            </td>
            <td className="baseline-right">
              {hospitalDisplayName(selected.hospital.id)}
              <div className="baseline-why baseline-why-ok">
                ✓ {selected.hospital.bed_count} beds open, treats {specialtyLabel(triage.required_hospital_specialty).toLowerCase()}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        Naive pick source: <code>{baseline.data_source}</code> — literally the nearest unit and hospital,
        with no check for capability, capacity, or whether they're even open.
      </p>
    </div>
  );
}
