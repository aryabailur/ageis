import { useEffect, useRef } from "react";
import type { ConversationMessage } from "../../store/voiceStore";

interface TranscriptStreamProps {
  messages: ConversationMessage[];
  interimText: string;
}

export function TranscriptStream({ messages, interimText }: TranscriptStreamProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, interimText]);

  return (
    <div className="mobile-transcript">
      {messages.length === 0 && !interimText && (
        <p className="mobile-transcript-hint">Start speaking — AEGIS is listening.</p>
      )}
      {messages.map((m, i) => (
        <div key={i} className={`mobile-bubble mobile-bubble-${m.role}`}>
          {m.text}
        </div>
      ))}
      {interimText && <div className="mobile-bubble mobile-bubble-patient mobile-bubble-interim">{interimText}</div>}
      <div ref={endRef} />
    </div>
  );
}
