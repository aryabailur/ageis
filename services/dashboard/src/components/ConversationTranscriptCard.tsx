import { useEffect, useRef } from "react";
import { useVoiceStore } from "../store/voiceStore";

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
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, interimText]);

  return (
    <div className="card panel-conversation">
      <div className="panel-header">
        <h2>AI conversation</h2>
        <span className="pill pill-muted">{messages.length} messages</span>
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
    </div>
  );
}
