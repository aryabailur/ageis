import type { CandidateAssignment, NaiveBaseline, TriageResult } from "../types";

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
      <h2>Naive baseline vs AEGIS</h2>
      <table className="baseline-table">
        <thead>
          <tr>
            <th></th>
            <th>Naive nearest-to-nearest</th>
            <th>AEGIS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="baseline-rowlabel">Ambulance</td>
            <td className={ambulanceWrong ? "baseline-wrong" : ""}>
              {baseline.ambulance.id} ({baseline.ambulance.capability})
              {ambulanceWrong && <div className="baseline-why">✕ ALS required — wrong care</div>}
            </td>
            <td className="baseline-right">
              {selected.ambulance.id} ({selected.ambulance.capability})
              <div className="baseline-why baseline-why-ok">✓ meets ALS requirement</div>
            </td>
          </tr>
          <tr>
            <td className="baseline-rowlabel">Hospital</td>
            <td className={hospitalWrong ? "baseline-wrong" : ""}>
              {baseline.hospital.id}
              {hospitalWrong && (
                <div className="baseline-why">✕ lacks {triage.required_hospital_specialty} capability</div>
              )}
            </td>
            <td className="baseline-right">
              {selected.hospital.id}
              <div className="baseline-why baseline-why-ok">
                ✓ {selected.hospital.bed_count} {triage.required_hospital_specialty ?? "general"} beds open
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        Baseline source: <code>{baseline.data_source}</code> — the single geographically closest unit and
        hospital with no capability, status, or capacity filtering.
      </p>
    </div>
  );
}
