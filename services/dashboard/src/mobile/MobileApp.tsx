import { useCallback, useEffect, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import { useDispatchStore } from "../store/dispatchStore";
import { useConversationOrchestrator } from "../hooks/useConversationOrchestrator";
import { HomeScreen } from "./HomeScreen";
import { CallScreen } from "./CallScreen";
import "./mobile.css";

function newCallId(): string {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEMO_FALLBACK_LAT = 19.0596;
const DEMO_FALLBACK_LNG = 72.8295;

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
  const resetVoice = useVoiceStore((s) => s.reset);
  const dispatchReadyPayload = useVoiceStore((s) => s.dispatchReadyPayload);
  const clearDispatchReadyPayload = useVoiceStore((s) => s.clearDispatchReadyPayload);
  const startDispatch = useDispatchStore((s) => s.startDispatch);
  const resetDispatch = useDispatchStore((s) => s.reset);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // /call mounts MobileApp instead of the desktop App component, so it
  // must consume the ready payload here. Otherwise the UI says dispatch
  // started while no request ever reaches the dispatch pipeline.
  useEffect(() => {
    if (!dispatchReadyPayload) return;
    const payload = dispatchReadyPayload;
    clearDispatchReadyPayload();
    void startDispatch({
      call_id: payload.call_id,
      raw_transcript: payload.raw_transcript,
      caller_lat: payload.caller_lat || DEMO_FALLBACK_LAT,
      caller_lng: payload.caller_lng || DEMO_FALLBACK_LNG,
    });
  }, [dispatchReadyPayload, clearDispatchReadyPayload, startDispatch]);

  const handleStart = useCallback(async () => {
    resetVoice();
    resetDispatch();
    setScreen("call");
    const callId = newCallId();
    await orchestrator.start(callId);
  }, [orchestrator, resetVoice, resetDispatch]);

  const handleEnd = useCallback(() => {
    orchestrator.stop();
    setScreen("home");
  }, [orchestrator]);

  return (
    <div className="mobile-root">
      {screen === "home" ? (
        <HomeScreen onStart={handleStart} unsupported={!orchestrator.isSupported} />
      ) : (
        <CallScreen
          status={orchestrator.status}
          error={orchestrator.error}
          isMuted={orchestrator.isMuted}
          onToggleMute={() => orchestrator.setMuted(!orchestrator.isMuted)}
          onEnd={handleEnd}
        />
      )}
    </div>
  );
}
