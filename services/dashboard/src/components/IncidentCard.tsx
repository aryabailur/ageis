import type { Incident } from "../types";

function YesNoUnknown({ value }: { value: boolean | null }) {
  if (value === null) return <span className="muted">unknown</span>;
  return value ? <span className="pill pill-error">yes</span> : <span className="pill pill-success">no</span>;
}

export function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <div className="card">
      <h2>Incident</h2>
      <dl className="field-list">
        <dt>Chief complaint</dt>
        <dd>{incident.chief_complaint}</dd>

        <dt>Breathing normally</dt>
        <dd>
          <YesNoUnknown value={incident.breathing_normally} />
        </dd>

        <dt>Major bleeding</dt>
        <dd>
          <YesNoUnknown value={incident.major_bleeding} />
        </dd>

        <dt>Transcript quality</dt>
        <dd>
          <span className={`pill pill-${incident.transcript_quality === "low" ? "error" : "success"}`}>
            {incident.transcript_quality}
          </span>
        </dd>

        <dt>Extraction source</dt>
        <dd className="muted">{incident.extraction_data_source}</dd>
      </dl>
      <details>
        <summary>Raw transcript</summary>
        <p className="transcript">{incident.raw_transcript}</p>
      </details>
    </div>
  );
}
