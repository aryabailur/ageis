import { useCallback, useEffect, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import { useConversationOrchestrator } from "../hooks/useConversationOrchestrator";
import { useVoiceActivityDetector } from "../hooks/useVoiceActivityDetector";
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
 */
export function MobileApp() {
  const [screen, setScreen] = useState<"home" | "call">("home");
  const orchestrator = useConversationOrchestrator();
  const vad = useVoiceActivityDetector();
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
    await Promise.all([orchestrator.start(callId), vad.start()]);
  }, [orchestrator, vad, reset]);

  const handleEnd = useCallback(() => {
    orchestrator.stop();
    vad.stop();
    setScreen("home");
  }, [orchestrator, vad]);

  return (
    <div className="mobile-root">
      {screen === "home" ? (
        <HomeScreen onStart={handleStart} unsupported={!orchestrator.isSupported} />
      ) : (
        <CallScreen status={orchestrator.status} error={orchestrator.error} audioLevel={vad.audioLevel} onEnd={handleEnd} />
      )}
    </div>
  );
}
