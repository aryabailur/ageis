import type { TriageResult } from "../types";
import { ALS_EXPLAINER, PRIORITY_LABELS, ruleLabel, specialtyLabel } from "../glossary";

const PRIORITY_CLASS: Record<string, string> = {
  P1: "pill pill-error",
  P2: "pill pill-warning",
  P3: "pill pill-success",
  UNKNOWN: "pill pill-muted",
};

export function TriageCard({ triage }: { triage: TriageResult }) {
  return (
    <div className="card">
      <h2>Triage — how AEGIS classified this call</h2>
      <dl className="field-list">
        <dt>Severity</dt>
        <dd>
          <span className={PRIORITY_CLASS[triage.priority]}>{triage.priority}</span>
          <span className="muted field-inline-note"> — {PRIORITY_LABELS[triage.priority]}</span>
        </dd>

        <dt>Needs a paramedic crew?</dt>
        <dd>
          {triage.requires_als ? <span className="pill pill-error">yes — ALS</span> : <span className="pill pill-success">no — basic crew OK</span>}
          <span className="muted field-inline-note"> {ALS_EXPLAINER}</span>
        </dd>

        <dt>Hospital needs</dt>
        <dd>{specialtyLabel(triage.required_hospital_specialty)}</dd>

        <dt>Why (rules that fired)</dt>
        <dd className="rule-list">
          {triage.rule_ids.map((rule) => (
            <div key={rule} className="rule-row">
              <span className="tag">{rule}</span>
              <span className="muted rule-explain">{ruleLabel(rule)}</span>
            </div>
          ))}
        </dd>
      </dl>
    </div>
  );
}
