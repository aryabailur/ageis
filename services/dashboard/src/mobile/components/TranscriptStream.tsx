import { useEffect, useRef, useState } from "react";
import type { ConversationMessage } from "../../store/voiceStore";

interface TranscriptStreamProps {
  messages: ConversationMessage[];
  interimText: string;
}

function Bubble({ message, isNewest }: { message: ConversationMessage; isNewest: boolean }) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!isNewest || message.role !== "ai") return;
    // One-frame delay so the class addition itself triggers the CSS
    // animation restart rather than being present on first paint.
    const raf = requestAnimationFrame(() => setFlash(true));
    const clear = setTimeout(() => setFlash(false), 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewest, message.text]);

  return (
    <div className={`mobile-bubble-wrap mobile-bubble-wrap-${message.role}`}>
      <span className="mobile-bubble-label">{message.role === "ai" ? "AEGIS" : "You"}</span>
      <div className={`mobile-bubble mobile-bubble-${message.role} ${flash ? "mobile-bubble-flash" : ""}`}>
        {message.text}
      </div>
    </div>
  );
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
        <Bubble key={i} message={m} isNewest={i === messages.length - 1} />
      ))}
      {interimText && (
        <div className="mobile-bubble-wrap mobile-bubble-wrap-patient">
          <span className="mobile-bubble-label">You</span>
          <div className="mobile-bubble mobile-bubble-patient mobile-bubble-interim">{interimText}</div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
