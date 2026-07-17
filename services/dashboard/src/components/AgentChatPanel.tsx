import { useEffect, useRef, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";

function guidanceLine(
  callStatus: string,
  messageCount: number,
  emergencyType: string | null | undefined,
  breathing: string | null | undefined,
  readyForDispatch: boolean,
): string {
  if (readyForDispatch) return "✓ Extraction complete — dispatch workflow starting.";
  if (breathing === "abnormal" && emergencyType) return "⚠ Abnormal breathing detected — CPR coaching may activate.";
  if (callStatus === "idle") return "Waiting for an incoming call.";
  if (callStatus === "in_progress" && messageCount < 2) return "AI is gathering initial details — do not dispatch yet.";
  if (callStatus === "in_progress" && emergencyType) return `Complaint: ${emergencyType}. AI gathering location + vitals.`;
  return "AI is gathering initial details — do not dispatch yet.";
}

export function AgentChatPanel() {
  const callStatus = useVoiceStore((s) => s.callStatus);
  const conversationMessages = useVoiceStore((s) => s.conversationMessages);
  const interimText = useVoiceStore((s) => s.interimText);
  const patientDetails = useVoiceStore((s) => s.patientDetails);
  const readyForDispatch = useVoiceStore((s) => s.readyForDispatch);

  const isActive = callStatus !== "idle";
  const [expanded, setExpanded] = useState(isActive);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-expand the instant a call starts, mirroring the same "call
  // arrived" signal the rest of the dashboard reacts to -- never
  // auto-collapses on its own once the dispatcher has it open.
  useEffect(() => {
    if (isActive) setExpanded(true);
  }, [isActive]);

  useEffect(() => {
    if (expanded) setLastSeenCount(conversationMessages.length);
  }, [expanded, conversationMessages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversationMessages.length, interimText]);

  const unread = expanded ? 0 : conversationMessages.length - lastSeenCount;
  const guidance = guidanceLine(
    callStatus,
    conversationMessages.length,
    patientDetails.emergency_type,
    patientDetails.breathing,
    readyForDispatch,
  );
  const guidanceTone = guidance.startsWith("⚠") ? "warning" : guidance.startsWith("✓") ? "success" : "neutral";

  return (
    <div className="agent-chat-panel">
      <button className="agent-chat-panel-header" onClick={() => setExpanded((v) => !v)}>
        <span className="agent-chat-panel-header-left">
          <span className={`agent-chat-dot ${isActive ? "agent-chat-dot-active" : ""}`} aria-hidden="true" />
          {isActive ? "Live Caller Chat" : "No active call"}
        </span>
        <span className="agent-chat-panel-header-right">
          {unread > 0 && <span className="agent-chat-unread-badge">{unread}</span>}
          <span aria-hidden="true">{expanded ? "▲" : "▼"}</span>
        </span>
      </button>

      {expanded && (
        <div className="agent-chat-panel-body">
          <div className="agent-chat-summary-grid">
            <div className="agent-chat-summary-chip">
              <span className="agent-chat-summary-label">Chief complaint</span>
              <span className="agent-chat-summary-value">{patientDetails.emergency_type ?? "unknown"}</span>
            </div>
            <div className="agent-chat-summary-chip">
              <span className="agent-chat-summary-label">Breathing</span>
              <span className="agent-chat-summary-value">{patientDetails.breathing ?? "unknown"}</span>
            </div>
            <div className="agent-chat-summary-chip">
              <span className="agent-chat-summary-label">Conscious</span>
              <span className="agent-chat-summary-value">
                {patientDetails.conscious == null ? "unknown" : patientDetails.conscious ? "yes" : "no"}
              </span>
            </div>
            <div className="agent-chat-summary-chip">
              <span className="agent-chat-summary-label">Location</span>
              <span className="agent-chat-summary-value">{patientDetails.location_text ?? "unknown"}</span>
            </div>
          </div>

          <div className="agent-chat-transcript" ref={scrollRef}>
            {conversationMessages.length === 0 && !interimText && (
              <p className="agent-chat-transcript-hint">No messages yet.</p>
            )}
            {conversationMessages.map((m, i) => (
              <div key={i} className={`agent-chat-bubble agent-chat-bubble-${m.role}`}>
                {m.text}
              </div>
            ))}
            {interimText && <div className="agent-chat-bubble agent-chat-bubble-patient agent-chat-bubble-interim">{interimText}</div>}
          </div>

          <div className={`agent-chat-guidance agent-chat-guidance-${guidanceTone}`}>{guidance}</div>
        </div>
      )}
    </div>
  );
}
