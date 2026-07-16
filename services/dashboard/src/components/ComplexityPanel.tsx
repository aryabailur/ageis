import type { CandidateAssignment } from "../types";
import { ambulanceDisplayName, hospitalDisplayName } from "../glossary";

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
      <h2>How close was this call?</h2>
      <p className="muted panel-intro">
        When the top two options score nearly the same, AEGIS double-checks each one independently
        instead of just trusting the first-pass ranking.
      </p>
      <div className="complexity-gauge">
        <div
          className={`complexity-gauge-fill ${spawned ? "complexity-gauge-hot" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="muted">
        {pct}% too-close-to-call{" "}
        <span className="field-inline-note">(double-checks kick in above 50%)</span>
      </p>

      {spawned ? (
        <>
          <p className="complexity-spawn-note">
            Near-tie detected — ran {spawnedWorkers} independent double-check{spawnedWorkers === 1 ? "" : "s"} in
            parallel:
          </p>
          <div className="worker-chips">
            {reverifiedCandidates.map((candidate) => (
              <span
                key={`${candidate.ambulance.id}-${candidate.hospital.id}`}
                className={`worker-chip ${candidate.rejected ? "worker-chip-rejected" : ""}`}
              >
                {ambulanceDisplayName(candidate.ambulance.id)} → {hospitalDisplayName(candidate.hospital.id)}
                {candidate.rejected ? " ✕ ruled out" : ` · lower is better: ${candidate.score?.toFixed(2)}`}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="muted">Clear winner — no double-check needed.</p>
      )}
    </div>
  );
}
