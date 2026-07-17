import { useEffect, useMemo, useRef, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import { useDispatchStore } from "../store/dispatchStore";
import type { ConversationStatus } from "../hooks/useConversationOrchestrator";
import { TranscriptStream } from "./components/TranscriptStream";
import { ExtractionStrip } from "./components/ExtractionStrip";

interface CallScreenProps {
  status: ConversationStatus;
  error: string | null;
  onEnd: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STATUS_LABEL: Record<ConversationStatus, string> = {
  idle: "Connecting…",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "AEGIS is thinking…",
  speaking: "AEGIS is speaking",
  ended: "Call ended",
  error: "Connection issue",
};

function StatusIcon({ status }: { status: ConversationStatus }) {
  if (status === "listening") {
    return (
      <div className="mobile-status-icon mobile-status-icon-mic" aria-hidden="true">
        <span className="mobile-mic-bar" />
        <span className="mobile-mic-bar" />
        <span className="mobile-mic-bar" />
      </div>
    );
  }
  if (status === "thinking") {
    return (
      <div className="mobile-status-icon mobile-status-icon-dots" aria-hidden="true">
        <span className="mobile-dot" />
        <span className="mobile-dot" />
        <span className="mobile-dot" />
      </div>
    );
  }
  if (status === "speaking") {
    return (
      <div className="mobile-status-icon mobile-status-icon-speaking" aria-hidden="true">
        <span className="mobile-sound-arc mobile-sound-arc-1" />
        <span className="mobile-sound-arc mobile-sound-arc-2" />
        <span className="mobile-sound-arc mobile-sound-arc-3" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="mobile-status-icon mobile-status-icon-error" aria-hidden="true">
        ✕
      </div>
    );
  }
  // idle / connecting
  return <div className="mobile-status-icon mobile-status-icon-connecting" aria-hidden="true" />;
}

/** What AEGIS is doing right now / waiting for, in plain language --
 * derived from the same status prop driving the avatar plus voiceStore's
 * conversation state, never a second source of truth. */
function guidanceBannerText(
  status: ConversationStatus,
  messageCount: number,
  readyForDispatch: boolean,
): { text: string; tone: "neutral" | "success" } {
  if (readyForDispatch) {
    return { text: "✓ Help is being dispatched — stay on the line", tone: "success" };
  }
  if (status === "connecting" || status === "idle") {
    return { text: "Connecting to AEGIS dispatch…", tone: "neutral" };
  }
  if (status === "listening" && messageCount === 0) {
    return { text: "Go ahead — describe the emergency", tone: "neutral" };
  }
  if (status === "listening") {
    return { text: "AEGIS heard you — keep going or wait for the next question", tone: "neutral" };
  }
  if (status === "thinking") {
    return { text: "AEGIS is processing your response…", tone: "neutral" };
  }
  if (status === "speaking") {
    return { text: "Listen to AEGIS — then respond when ready", tone: "neutral" };
  }
  return { text: "", tone: "neutral" };
}

const HOLD_TO_END_MS = 1500;

function EndCallButton({ onEnd }: { onEnd: () => void }) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startHold() {
    setHolding(true);
    timerRef.current = setTimeout(() => {
      onEnd();
    }, HOLD_TO_END_MS);
  }

  function cancelHold() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  }

  useEffect(() => () => cancelHold(), []);

  return (
    <button
      className={`mobile-end-btn ${holding ? "mobile-end-btn-holding" : ""}`}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      aria-label="Hold to end call"
    >
      {holding && <span className="mobile-end-btn-progress-ring" aria-hidden="true" />}
      <span className="mobile-end-btn-label">{holding ? "Hold to end" : "End Call"}</span>
    </button>
  );
}

function DispatchDecisionCard() {
  const current = useDispatchStore((s) => s.current);
  const isRunning = useDispatchStore((s) => s.isRunning);

  if (isRunning) {
    return (
      <div className="mobile-dispatch-card mobile-dispatch-card-loading">
        <div className="mobile-dispatch-spinner" aria-hidden="true">
          <span className="mobile-dot" /><span className="mobile-dot" /><span className="mobile-dot" />
        </div>
        <p className="mobile-dispatch-loading-text">Dispatching nearest unit…</p>
      </div>
    );
  }

  const selected = current?.selected;

  if (!selected) {
    // Dispatch hasn't resolved yet or failed — show generic message
    return (
      <div className="mobile-dispatch-card">
        <p className="mobile-dispatch-generic">Emergency services have been notified. Help is on the way.</p>
      </div>
    );
  }

  const { ambulance, hospital, ambulance_eta_minutes, hospital_eta_minutes } = selected;

  return (
    <div className="mobile-dispatch-card mobile-dispatch-card-confirmed">
      <div className="mobile-dispatch-row">
        <span className="mobile-dispatch-icon" aria-hidden="true">🚑</span>
        <div className="mobile-dispatch-detail">
          <span className="mobile-dispatch-label">Ambulance</span>
          <span className="mobile-dispatch-value">{ambulance.id ?? "Unit dispatched"}</span>
          {ambulance_eta_minutes != null && (
            <span className="mobile-dispatch-eta">ETA {Math.round(ambulance_eta_minutes)} min</span>
          )}
        </div>
      </div>
      <div className="mobile-dispatch-divider" />
      <div className="mobile-dispatch-row">
        <span className="mobile-dispatch-icon" aria-hidden="true">🏥</span>
        <div className="mobile-dispatch-detail">
          <span className="mobile-dispatch-label">Hospital</span>
          <span className="mobile-dispatch-value">{hospital.id ?? "Nearest hospital"}</span>
          {hospital_eta_minutes != null && (
            <span className="mobile-dispatch-eta">ETA {Math.round(hospital_eta_minutes)} min</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CallEndedScreen({ elapsed, onEnd }: { elapsed: number; onEnd: () => void }) {
  return (
    <div className="mobile-outcome-screen">
      <div className="mobile-outcome-icon mobile-outcome-icon-success" aria-hidden="true">
        ✓
      </div>
      <h1 className="mobile-outcome-title">Help is on the way</h1>
      <p className="mobile-outcome-body">
        Stay calm. Responders have been notified. Keep the patient still and follow any instructions given.
      </p>
      <DispatchDecisionCard />
      <p className="mobile-outcome-duration">Call duration: {formatDuration(elapsed)}</p>
      <button className="mobile-outcome-btn" onClick={onEnd}>
        Done
      </button>
    </div>
  );
}

function ConnectionErrorScreen({ onEnd }: { onEnd: () => void }) {
  return (
    <div className="mobile-outcome-screen">
      <div className="mobile-outcome-icon mobile-outcome-icon-error" aria-hidden="true">
        ✕
      </div>
      <h1 className="mobile-outcome-title">Connection lost</h1>
      <p className="mobile-outcome-body">AEGIS is trying to reconnect automatically.</p>
      <button className="mobile-outcome-btn" onClick={onEnd}>
        Try again
      </button>
    </div>
  );
}

export function CallScreen({ status, error, onEnd }: CallScreenProps) {
  const conversationMessages = useVoiceStore((s) => s.conversationMessages);
  const interimText = useVoiceStore((s) => s.interimText);
  const patientDetails = useVoiceStore((s) => s.patientDetails);
  const readyForDispatch = useVoiceStore((s) => s.readyForDispatch);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const pulseClass = useMemo(() => {
    if (status === "speaking") return "mobile-avatar-speaking";
    if (status === "listening") return "mobile-avatar-listening";
    if (status === "thinking") return "mobile-avatar-thinking";
    return "";
  }, [status]);

  const banner = guidanceBannerText(status, conversationMessages.length, readyForDispatch);

  if (status === "ended") {
    return <CallEndedScreen elapsed={elapsed} onEnd={onEnd} />;
  }

  if (status === "error" && error) {
    return <ConnectionErrorScreen onEnd={onEnd} />;
  }

  return (
    <div className="mobile-call">
      <div className="mobile-call-header">
        <div className={`mobile-avatar ${pulseClass}`} aria-hidden="true">
          <StatusIcon status={status} />
        </div>
        <div className="mobile-call-status">{STATUS_LABEL[status]}</div>
        <div className="mobile-call-timer">{formatDuration(elapsed)}</div>
      </div>

      {banner.text && (
        <div className={`mobile-guidance-banner ${banner.tone === "success" ? "mobile-guidance-banner-success" : ""}`}>
          {banner.text}
        </div>
      )}

      <ExtractionStrip patientDetails={patientDetails} />

      {error && <div className="mobile-call-error">{error}</div>}

      <TranscriptStream messages={conversationMessages} interimText={isMuted ? "" : interimText} />

      <div className="mobile-call-controls">
        <button
          className={`mobile-control-btn ${isMuted ? "mobile-control-btn-active" : ""}`}
          onClick={() => setIsMuted((m) => !m)}
          aria-label={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>
        <EndCallButton onEnd={onEnd} />
        <button
          className="mobile-control-btn"
          onClick={() => window.speechSynthesis?.cancel()}
          aria-label="Skip AI speech"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
