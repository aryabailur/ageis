export function ComplexityPanel({
  complexityScore,
  spawnedWorkers,
}: {
  complexityScore: number | null;
  spawnedWorkers: number;
}) {
  const pct = Math.round((complexityScore ?? 0) * 100);
  return (
    <div className="card">
      <h2>Ranking complexity</h2>
      <div className="complexity-gauge">
        <div className="complexity-gauge-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted">
        complexity_score = {complexityScore?.toFixed(2) ?? "—"} · spawned_workers = {spawnedWorkers}
      </p>
    </div>
  );
}
