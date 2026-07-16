import { useEffect, useMemo, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import type { ConversationStatus } from "../hooks/useConversationOrchestrator";
import { Waveform } from "./components/Waveform";
import { TranscriptStream } from "./components/TranscriptStream";

interface CallScreenProps {
  status: ConversationStatus;
  error: string | null;
  audioLevel: number | null;
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

export function CallScreen({ status, error, audioLevel, onEnd }: CallScreenProps) {
  const conversationMessages = useVoiceStore((s) => s.conversationMessages);
  const interimText = useVoiceStore((s) => s.interimText);
  const [isMuted, setIsMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const isActive = status === "listening" || status === "thinking" || status === "speaking";

  const pulseClass = useMemo(() => {
    if (status === "speaking") return "mobile-avatar-speaking";
    if (status === "listening") return "mobile-avatar-listening";
    if (status === "thinking") return "mobile-avatar-thinking";
    return "";
  }, [status]);

  return (
    <div className="mobile-call">
      <div className="mobile-call-header">
        <div className={`mobile-avatar ${pulseClass}`} aria-hidden="true">
          ▲
        </div>
        <div className="mobile-call-status">{STATUS_LABEL[status]}</div>
        <div className="mobile-call-timer">{formatDuration(elapsed)}</div>
      </div>

      <Waveform level={audioLevel} active={isActive} />

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
        <button className="mobile-end-btn" onClick={onEnd} aria-label="End call">
          End Call
        </button>
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
