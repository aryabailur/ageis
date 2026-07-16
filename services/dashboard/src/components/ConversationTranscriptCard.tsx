import { useVoiceStore } from "../store/voiceStore";

/**
 * Message-by-message AI/patient transcript from the AI conversation
 * feature -- distinct from IncomingCallCard's single running transcript
 * blob, this shows the actual back-and-forth so the operator can read
 * exactly what was asked and answered. Reads the same voiceStore fields
 * PatientDetailsCard does; no new socket.
 */
export function ConversationTranscriptCard() {
  const messages = useVoiceStore((s) => s.conversationMessages);
  const callId = useVoiceStore((s) => s.callId);

  return (
    <div className="card">
      <div className="call-card-header">
        <h2>AI conversation</h2>
        <span className="pill pill-muted">{messages.length} messages</span>
      </div>
      {!callId || messages.length === 0 ? (
        <p className="muted">No AI conversation in progress. Open /call on a phone to start one.</p>
      ) : (
        <div className="call-transcript-box" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {messages.map((m, i) => (
            <p key={i} style={{ margin: 0 }}>
              <strong>{m.role === "ai" ? "AEGIS: " : "Patient: "}</strong>
              {m.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
