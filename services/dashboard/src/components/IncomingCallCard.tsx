import { useEffect, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import { useBrowserSpeechRecognition } from "../hooks/useBrowserSpeechRecognition";

const STATUS_LABEL: Record<string, string> = {
  idle: "No active call",
  connecting: "Connecting…",
  in_progress: "Live",
  ended: "Call ended",
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

/**
 * Waveform driven by real mic input level (see useBrowserSpeechRecognition's
 * audioLevel, sourced from an AnalyserNode on the actual mic stream) for
 * browser mode. There's no equivalent per-call audio-level signal
 * surfaced from the Twilio/Deepgram path today, so Twilio-sourced calls
 * intentionally render a flat/static bar rather than a fabricated
 * animation -- honest silence beats a fake waveform.
 */
function Waveform({ level }: { level: number | null }) {
  const bars = 24;
  return (
    <div className="call-waveform" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const phase = Math.sin((i / bars) * Math.PI);
        const height = level === null ? 0.08 : Math.max(0.08, level * phase);
        return <span key={i} className="call-waveform-bar" style={{ height: `${height * 100}%` }} />;
      })}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Props {
  /** Called when the user explicitly wants to hand the accumulated
   * transcript to the existing dispatch pipeline -- never automatic. */
  onUseTranscript: (transcript: string) => void;
}

export function IncomingCallCard({ onUseTranscript }: Props) {
  const { currentTranscript, interimText, callId, callerNumber, callStatus, isSocketConnected, source, connect, reset } =
    useVoiceStore();
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

  function handleStopMic() {
    stop();
  }

  const displayTranscript = [currentTranscript, interimText].filter(Boolean).join(" ");

  return (
    <div className="card call-card">
      <div className="call-card-header">
        <h2>Incoming call</h2>
        <span className={`pill ${callStatus === "in_progress" || isListening ? "pill-success" : "pill-muted"}`}>
          {isListening ? "Live" : STATUS_LABEL[callStatus] ?? "No active call"}
        </span>
      </div>

      <dl className="call-meta-grid">
        <dt>Caller number</dt>
        <dd>{callerNumber ?? (isListening ? "This browser (mic)" : "—")}</dd>

        <dt>Call duration</dt>
        <dd className="field-mono">{formatDuration(liveDuration || 0)}</dd>

        <dt>Connection</dt>
        <dd>
          <span className={`pill ${isSocketConnected ? "pill-success" : "pill-error"}`}>
            {isSocketConnected ? "connected" : "disconnected"}
          </span>
          {source && <span className="muted field-inline-note-small"> via {source === "browser" ? "browser mic" : "phone (Twilio)"}</span>}
        </dd>
      </dl>

      <Waveform level={isListening ? audioLevel : null} />

      <div className="call-transcript-box">
        {displayTranscript ? (
          <p>
            {currentTranscript}
            {interimText && <span className="call-transcript-interim"> {interimText}</span>}
          </p>
        ) : (
          <p className="muted">Transcript will appear here as the caller speaks.</p>
        )}
      </div>

      <div className="call-card-actions">
        {!isListening ? (
          <button type="button" className="btn-small" onClick={handleStartMic} disabled={!isSupported}>
            Start microphone
          </button>
        ) : (
          <button type="button" className="btn-small btn-danger" onClick={handleStopMic}>
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

      {!isSupported && (
        <p className="muted call-card-note">
          Live browser transcription needs Chrome or Edge. Phone calls via Twilio work regardless of browser
          once configured (see PUBLIC_TUNNEL_URL in .env).
        </p>
      )}
      {error && <p className="card-error-inline">{error}</p>}
      {callId && <p className="muted call-card-note field-mono">call_id: {callId}</p>}
    </div>
  );
}
