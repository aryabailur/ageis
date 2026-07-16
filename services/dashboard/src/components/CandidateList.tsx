import type { CandidateAssignment } from "../types";

function isSelected(candidate: CandidateAssignment, selected: CandidateAssignment | null): boolean {
  if (!selected) return false;
  return candidate.ambulance.id === selected.ambulance.id && candidate.hospital.id === selected.hospital.id;
}

export function CandidateList({
  candidates,
  selected,
}: {
  candidates: CandidateAssignment[];
  selected: CandidateAssignment | null;
}) {
  if (candidates.length === 0) {
    return (
      <div className="card">
        <h2>Candidates considered</h2>
        <p className="muted">No candidates were evaluated.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Candidates considered</h2>
      <ul className="candidate-list">
        {candidates.map((candidate) => {
          const chosen = isSelected(candidate, selected);
          return (
            <li
              key={`${candidate.ambulance.id}-${candidate.hospital.id}`}
              className={`candidate-row ${candidate.rejected ? "candidate-rejected" : chosen ? "candidate-chosen" : ""}`}
            >
              <div className="candidate-icon">{candidate.rejected ? "✕" : chosen ? "✓" : "•"}</div>
              <div className="candidate-body">
                <div className="candidate-pair">
                  <span className="tag">{candidate.ambulance.id}</span>
                  <span className="tag-arrow">→</span>
                  <span className="tag">{candidate.hospital.id}</span>
                  {chosen && <span className="pill pill-success">selected</span>}
                </div>
                {candidate.rejected ? (
                  <p className="candidate-reason">{candidate.rejection?.human_text}</p>
                ) : (
                  <p className="candidate-meta">
                    ETA to patient {candidate.ambulance_eta_minutes?.toFixed(1)} min · ETA to hospital{" "}
                    {candidate.hospital_eta_minutes?.toFixed(1)} min · score {candidate.score?.toFixed(2)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
