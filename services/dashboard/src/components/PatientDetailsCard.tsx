import { useVoiceStore } from "../store/voiceStore";

const BREATHING_LABEL: Record<string, string> = {
  normal: "Breathing normally",
  abnormal: "Breathing abnormally",
  unknown: "Unknown",
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  serious: "Serious",
  moderate: "Moderate",
  minor: "Minor",
};

/**
 * Live view of the AI conversation's structured patient-detail extraction
 * (see voice/conversation.py). Reads the same /voice/live socket
 * IncomingCallCard already connects to via voiceStore -- no new
 * transport. Purely additive: renders nothing when no AI-mode call is
 * in progress, and never mutates dispatch state itself.
 */
export function PatientDetailsCard() {
  const patientDetails = useVoiceStore((s) => s.patientDetails);
  const readyForDispatch = useVoiceStore((s) => s.readyForDispatch);
  const callId = useVoiceStore((s) => s.callId);

  const hasAnyDetail = Object.keys(patientDetails).length > 0;
  if (!callId || !hasAnyDetail) {
    return (
      <div className="card">
        <div className="call-card-header">
          <h2>Patient details</h2>
          <span className="pill pill-muted">Waiting for AI call</span>
        </div>
        <p className="muted">Details extracted from the AI conversation will appear here as the patient speaks.</p>
      </div>
    );
  }

  const rows: [string, string][] = [
    ["Name", patientDetails.name ?? "—"],
    ["Age", patientDetails.age != null ? String(patientDetails.age) : "—"],
    ["Phone", patientDetails.phone ?? "—"],
    ["Emergency type", patientDetails.emergency_type ?? "—"],
    ["Symptoms", patientDetails.symptoms ?? "—"],
    ["Location", patientDetails.location_text ?? "—"],
    ["Breathing", patientDetails.breathing ? BREATHING_LABEL[patientDetails.breathing] ?? patientDetails.breathing : "—"],
    ["Conscious", patientDetails.conscious == null ? "—" : patientDetails.conscious ? "Yes" : "No"],
    ["Victims", patientDetails.victims != null ? String(patientDetails.victims) : "—"],
    ["Severity", patientDetails.severity ? SEVERITY_LABEL[patientDetails.severity] ?? patientDetails.severity : "—"],
  ];

  return (
    <div className="card">
      <div className="call-card-header">
        <h2>Patient details</h2>
        <span className={`pill ${readyForDispatch ? "pill-success" : "pill-warning"}`}>
          {readyForDispatch ? "Ready — dispatch starting" : "Gathering info…"}
        </span>
      </div>
      <dl className="call-meta-grid">
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {patientDetails.confidence != null && (
        <p className="muted field-inline-note-small">
          Extraction confidence: {Math.round((patientDetails.confidence ?? 0) * 100)}%
        </p>
      )}
    </div>
  );
}
