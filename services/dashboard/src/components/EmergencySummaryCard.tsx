import { useEffect, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import { useBrowserSpeechRecognition } from "../hooks/useBrowserSpeechRecognition";
import { Chip } from "./Chip";

const STATUS_LABEL: Record<string, string> = {
  idle: "No active call",
  connecting: "Connecting…",
  in_progress: "Live",
  ended: "Call ended",
  ready_for_dispatch: "Ready for dispatch",
};

const BREATHING_LABEL: Record<string, string> = {
  normal: "Normal",
  abnormal: "Abnormal",
  unknown: "Unknown",
};

const SEVERITY_TONE: Record<string, "error" | "warning" | "info" | "success"> = {
  critical: "error",
  serious: "warning",
  moderate: "info",
  minor: "success",
};

function useTicker(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return tick;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Small mic-level waveform -- real signal only (see
 * useBrowserSpeechRecognition's audioLevel, sourced from an AnalyserNode
 * on the actual mic stream), never a decorative loop. Same honesty
 * constraint the previous IncomingCallCard waveform enforced.
 */
function Waveform({ level }: { level: number | null }) {
  const bars = 20;
  return (
    <div className="summary-waveform" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const phase = Math.sin((i / bars) * Math.PI);
        const height = level === null ? 0.08 : Math.max(0.08, level * phase);
        return <span key={i} className="summary-waveform-bar" style={{ height: `${height * 100}%` }} />;
      })}
    </div>
  );
}

interface Props {
  /** Called when the user explicitly wants to hand the accumulated
   * transcript to the existing dispatch pipeline -- never automatic. */
  onUseTranscript: (transcript: string) => void;
}

/**
 * Left-rail "Emergency Summary" card -- visually merges what were two
 * separate cards (IncomingCallCard's live-call plumbing and
 * PatientDetailsCard's AI-extracted fields) into one premium information
 * card, per the redesign brief. Reads the exact same voiceStore fields
 * and useBrowserSpeechRecognition hook those two components already
 * used; no new state, no new API calls.
 */
export function EmergencySummaryCard({ onUseTranscript }: Props) {
  const {
    currentTranscript,
    interimText,
    callId,
    callerNumber,
    callStatus,
    isSocketConnected,
    source,
    patientDetails,
    readyForDispatch,
    connect,
    reset,
  } = useVoiceStore();
  const { isSupported, isListening, audioLevel, error, start, stop } = useBrowserSpeechRecognition();

  useEffect(() => {
    connect();
  }, [connect]);

  const tick = useTicker(isListening || callStatus === "in_progress");
  void tick;
  const durationSeconds = useVoiceStore((s) => s.callDurationS);
  const [localStartedAt] = useState(() => Date.now());
  const liveDuration = isListening ? (Date.now() - localStartedAt) / 1000 : durationSeconds;

  async function handleStartMic() {
    reset();
    const callIdForSession = `voice-${Date.now().toString(36)}`;
    await start(callIdForSession);
  }

  const displayTranscript = [currentTranscript, interimText].filter(Boolean).join(" ");
  const hasPatientDetails = Object.keys(patientDetails).length > 0;
  const severityTone = patientDetails.severity ? SEVERITY_TONE[patientDetails.severity] ?? "info" : "info";

  return (
    <div className="card panel-summary">
      <div className="panel-header">
        <h2>Emergency summary</h2>
        <span className={`pill ${callStatus === "in_progress" || isListening ? "pill-success" : "pill-muted"}`}>
          {isListening ? "Live" : STATUS_LABEL[callStatus] ?? "No active call"}
        </span>
      </div>

      <div className="summary-caller-row">
        <div className="summary-avatar" aria-hidden="true">
          {patientDetails.name ? patientDetails.name.charAt(0).toUpperCase() : "?"}
        </div>
        <div className="summary-caller-meta">
          <span className="summary-caller-name">{patientDetails.name ?? "Caller unidentified"}</span>
          <span className="summary-caller-phone field-mono">
            {callerNumber ?? patientDetails.phone ?? (isListening ? "This browser (mic)" : "—")}
          </span>
        </div>
        <div className="summary-caller-timer field-mono">{formatDuration(liveDuration || 0)}</div>
      </div>

      <Waveform level={isListening ? audioLevel : null} />

      <div className="chip-grid">
        <Chip label="Status" value={STATUS_LABEL[callStatus] ?? "Idle"} tone={readyForDispatch ? "success" : "neutral"} />
        <Chip label="Type" value={patientDetails.emergency_type ?? "—"} tone="neutral" pending={!patientDetails.emergency_type} />
        <Chip
          label="Priority"
          value={patientDetails.severity ? patientDetails.severity.toUpperCase() : "—"}
          tone={patientDetails.severity ? severityTone : "neutral"}
          pending={!patientDetails.severity}
        />
        <Chip
          label="Condition"
          value={patientDetails.symptoms ?? "—"}
          tone="neutral"
          pending={!patientDetails.symptoms}
        />
        <Chip
          label="Confidence"
          value={patientDetails.confidence != null ? `${Math.round(patientDetails.confidence * 100)}%` : "—"}
          tone="info"
          pending={patientDetails.confidence == null}
        />
        <Chip label="Address" value={patientDetails.location_text ?? "—"} tone="neutral" pending={!patientDetails.location_text} />
        <Chip
          label="Breathing"
          value={patientDetails.breathing ? BREATHING_LABEL[patientDetails.breathing] ?? patientDetails.breathing : "—"}
          tone={patientDetails.breathing === "abnormal" ? "error" : "neutral"}
          pending={!patientDetails.breathing}
        />
        <Chip
          label="Conscious"
          value={patientDetails.conscious == null ? "—" : patientDetails.conscious ? "Yes" : "No"}
          tone={patientDetails.conscious === false ? "error" : "neutral"}
          pending={patientDetails.conscious == null}
        />
      </div>

      <div className="summary-transcript-box">
        {displayTranscript ? (
          <p>
            {currentTranscript}
            {interimText && <span className="summary-transcript-interim"> {interimText}</span>}
          </p>
        ) : (
          <p className="muted">Transcript will appear here as the caller speaks.</p>
        )}
      </div>

      <div className="panel-actions">
        {!isListening ? (
          <button type="button" className="btn-small" onClick={handleStartMic} disabled={!isSupported}>
            Start microphone
          </button>
        ) : (
          <button type="button" className="btn-small btn-danger" onClick={stop}>
            Stop microphone
          </button>
        )}
        <button
          type="button"
          className="btn-small btn-inline"
          disabled={!displayTranscript.trim()}
          onClick={() => onUseTranscript(displayTranscript.trim())}
          title="Send this transcript into the dispatch pipeline — nothing is dispatched automatically"
        >
          Use this transcript
        </button>
      </div>

      <div className="summary-footer">
        <span className={`connection-dot ${isSocketConnected ? "connection-dot-live" : ""}`} />
        <span className="muted field-inline-note-small">
          {isSocketConnected ? "connected" : "disconnected"}
          {source && ` · via ${source === "browser" ? "browser mic" : source === "ai" ? "AI phone call" : "phone (Twilio)"}`}
        </span>
        {!isSupported && (
          <span className="muted field-inline-note-small"> · live transcription needs Chrome or Edge</span>
        )}
      </div>

      {error && <p className="card-error-inline">{error}</p>}
      {callId && <p className="muted call-card-note field-mono">call_id: {callId}</p>}
      {!hasPatientDetails && callId && (
        <p className="muted field-inline-note-small">Patient details populate once the AI conversation extracts them.</p>
      )}
    </div>
  );
}
