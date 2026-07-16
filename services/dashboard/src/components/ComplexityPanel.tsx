import type { CandidateAssignment } from "../types";

/**
 * Shows the targeted-parallel-spawning decision: the deterministic
 * complexity gauge, and -- when it crossed the spawn threshold -- one chip
 * per parallel reverification worker that actually ran (each worker
 * independently re-scored one viable candidate via the Send API).
 */
export function ComplexityPanel({
  complexityScore,
  spawnedWorkers,
  reverifiedCandidates,
}: {
  complexityScore: number | null;
  spawnedWorkers: number;
  reverifiedCandidates: CandidateAssignment[];
}) {
  const pct = Math.round((complexityScore ?? 0) * 100);
  const spawned = spawnedWorkers > 0;

  return (
    <div className="card">
      <h2>Ranking complexity</h2>
      <div className="complexity-gauge">
        <div
          className={`complexity-gauge-fill ${spawned ? "complexity-gauge-hot" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="muted">
        complexity_score = {complexityScore?.toFixed(2) ?? "—"} (spawn threshold 0.50)
      </p>

      {spawned ? (
        <>
          <p className="complexity-spawn-note">
            Near-tie detected — spawned {spawnedWorkers} parallel reverification worker
            {spawnedWorkers === 1 ? "" : "s"}:
          </p>
          <div className="worker-chips">
            {reverifiedCandidates.map((candidate) => (
              <span
                key={`${candidate.ambulance.id}-${candidate.hospital.id}`}
                className={`worker-chip ${candidate.rejected ? "worker-chip-rejected" : ""}`}
              >
                {candidate.ambulance.id} → {candidate.hospital.id}
                {candidate.rejected ? " ✕" : ` · ${candidate.score?.toFixed(2)}`}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">Clear winner — no parallel workers needed.</p>
      )}
    </div>
  );
}
