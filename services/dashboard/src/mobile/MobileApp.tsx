import { useCallback, useEffect, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import { useConversationOrchestrator } from "../hooks/useConversationOrchestrator";
import { HomeScreen } from "./HomeScreen";
import { CallScreen } from "./CallScreen";
import "./mobile.css";

function newCallId(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Root component for the mobile AI emergency voice assistant, mounted at
 * /call (see main.tsx). Fully separate from the existing dashboard tree
 * in App.tsx -- this is an additive experience, not a replacement.
 *
 * Deliberately does NOT run a second getUserMedia()-based audio-level
 * meter alongside SpeechRecognition: on at least one real Android Chrome
 * device, two concurrent mic consumers left SpeechRecognition running
 * with no results and no errors indefinitely. CallScreen's status icons
 * are driven by conversation state instead, not real audio level.
 */
export function MobileApp() {
  const [screen, setScreen] = useState<"home" | "call">("home");
  const orchestrator = useConversationOrchestrator();
  const connect = useVoiceStore((s) => s.connect);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const reset = useVoiceStore((s) => s.reset);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const handleStart = useCallback(async () => {
    reset();
    setScreen("call");
    const callId = newCallId();
    await orchestrator.start(callId);
  }, [orchestrator, reset]);

  const handleEnd = useCallback(() => {
    orchestrator.stop();
    setScreen("home");
  }, [orchestrator]);

  return (
    <div className="mobile-root">
      {screen === "home" ? (
        <HomeScreen onStart={handleStart} unsupported={!orchestrator.isSupported} />
      ) : (
        <CallScreen status={orchestrator.status} error={orchestrator.error} onEnd={handleEnd} />
      )}
    </div>
  );
}
