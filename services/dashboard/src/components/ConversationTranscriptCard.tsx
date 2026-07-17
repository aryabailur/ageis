import { useEffect, useRef, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";

function confidenceColor(confidence: number): string {
  if (confidence < 0.4) return "var(--status-critical)";
  if (confidence < 0.7) return "var(--status-warning)";
  return "var(--status-success)";
}

/**
 * Message-by-message AI/patient transcript from the AI conversation
 * feature, rendered as chat bubbles -- distinct from IncomingCallCard's
 * single running transcript blob, this shows the actual back-and-forth
 * so the operator can read exactly what was asked and answered. Reads
 * the same voiceStore fields PatientDetailsCard does; no new socket.
 */
export function ConversationTranscriptCard() {
  const messages = useVoiceStore((s) => s.conversationMessages);
  const interimText = useVoiceStore((s) => s.interimText);
  const callId = useVoiceStore((s) => s.callId);
  const callStatus = useVoiceStore((s) => s.callStatus);
  const confidence = useVoiceStore((s) => s.patientDetails.confidence);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, interimText]);

  async function handleCopy() {
    const text = messages.map((m) => `${m.role === "ai" ? "AEGIS" : "Caller"}: ${m.text}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied/unavailable -- the transcript is
      // still fully visible on-screen either way.
    }
  }

  const isLive = callStatus === "in_progress";

  return (
    <div className="card panel-conversation">
      <div className="panel-header">
        <h2>AI conversation</h2>
        <div className="panel-header-actions">
          {callId && <span className={`pill ${isLive ? "conversation-card-pill-live" : "conversation-card-pill-ended"}`}>{isLive ? "LIVE" : "ENDED"}</span>}
          <span className="pill pill-muted">{messages.length} messages</span>
          {messages.length > 0 && (
            <button className="conversation-card-copy-btn" onClick={handleCopy}>
              {copied && <span className="conversation-card-copy-tooltip">Copied!</span>}
              Copy transcript
            </button>
          )}
        </div>
      </div>
      {!callId || messages.length === 0 ? (
        <p className="muted">No AI conversation in progress. Open /call on a phone to start one.</p>
      ) : (
        <div className="chat-thread">
          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble chat-bubble-${m.role}`}>
              <span className="chat-bubble-role">{m.role === "ai" ? "AEGIS" : "Patient"}</span>
              {m.text}
            </div>
          ))}
          {interimText && <div className="chat-bubble chat-bubble-patient chat-bubble-interim">{interimText}</div>}
          <div ref={endRef} />
        </div>
      )}
      {confidence != null && (
        <div className="conversation-card-confidence">
          <div className="conversation-card-confidence-label">Extraction confidence: {Math.round(confidence * 100)}%</div>
          <div className="conversation-card-confidence-track">
            <div
              className="conversation-card-confidence-fill"
              style={{ width: `${Math.round(confidence * 100)}%`, background: confidenceColor(confidence) }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
