import type { TriageResult } from "../types";

const PRIORITY_CLASS: Record<string, string> = {
  P1: "pill pill-error",
  P2: "pill pill-warning",
  P3: "pill pill-success",
  UNKNOWN: "pill pill-muted",
};

export function TriageCard({ triage }: { triage: TriageResult }) {
  return (
    <div className="card">
      <h2>Triage</h2>
      <dl className="field-list">
        <dt>Priority</dt>
        <dd>
          <span className={PRIORITY_CLASS[triage.priority]}>{triage.priority}</span>
        </dd>

        <dt>Requires ALS</dt>
        <dd>{triage.requires_als ? <span className="pill pill-error">yes</span> : <span className="pill pill-success">no</span>}</dd>

        <dt>Required hospital specialty</dt>
        <dd>{triage.required_hospital_specialty ?? <span className="muted">none</span>}</dd>

        <dt>Rules fired</dt>
        <dd>
          {triage.rule_ids.map((rule) => (
            <span key={rule} className="tag">
              {rule}
            </span>
          ))}
        </dd>
      </dl>
    </div>
  );
}
