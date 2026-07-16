import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:8000";

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type ConversationStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "ended" | "error";

export interface UseConversationOrchestratorResult {
  status: ConversationStatus;
  error: string | null;
  isSupported: boolean;
  start: (callId: string) => Promise<void>;
  stop: () => void;
}

/**
 * The "ConversationService" glue on the frontend: continuous two-way
 * turn-taking with no push-to-talk. Listens for SpeechRecognition final
 * results, posts them to the existing /voice/browser/transcript endpoint
 * with conversation_mode: true (the ONLY new wiring on that endpoint --
 * the plain browser-mic flow used by IncomingCallCard never sets this
 * flag), and speaks the AI's reply back via SpeechSynthesis, pausing
 * recognition while the AI is talking so it doesn't transcribe itself.
 *
 * This hook is the seam: swapping browser STT/TTS for a realtime voice
 * API later means replacing what's inside this file only -- nothing
 * downstream (conversation.py, the dashboard) needs to change.
 */
export function useConversationOrchestrator(): UseConversationOrchestratorResult {
  const [status, setStatus] = useState<ConversationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const callIdRef = useRef<string | null>(null);
  const wantsListeningRef = useRef(false);
  const speakingRef = useRef(false);
  const lastAiTextRef = useRef<string>("");

  const Ctor = getSpeechRecognitionCtor();
  const isSupported = Ctor !== null && "speechSynthesis" in window;

  const speak = useCallback((text: string) => {
    if (!text.trim()) return;
    speakingRef.current = true;
    setStatus("speaking");
    recognitionRef.current?.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    // Hinglish/Hindi replies still read reasonably with a Hindi voice if
    // the OS has one; browsers fall back to a default voice otherwise.
    utterance.lang = /[ऀ-ॿ]/.test(text) ? "hi-IN" : "en-IN";

    utterance.onend = () => {
      speakingRef.current = false;
      if (wantsListeningRef.current) {
        setStatus("listening");
        try {
          recognitionRef.current?.start();
        } catch {
          // already started -- ignore
        }
      }
    };
    utterance.onerror = () => {
      speakingRef.current = false;
      if (wantsListeningRef.current) {
        setStatus("listening");
        try {
          recognitionRef.current?.start();
        } catch {
          // ignore
        }
      }
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // The AI's spoken reply arrives as a "transcript_update" broadcast with
  // source: "ai" over the SAME /voice/live socket voiceStore already
  // connects to -- read it from there instead of opening a second
  // connection.
  useEffect(() => {
    const unsubscribe = useVoiceStore.subscribe((state, prevState) => {
      if (state.callId !== callIdRef.current) return;
      const messages = state.conversationMessages;
      const prevMessages = prevState.conversationMessages;
      if (messages.length === prevMessages.length) return;
      const latest = messages[messages.length - 1];
      if (latest?.role === "ai" && latest.text !== lastAiTextRef.current) {
        lastAiTextRef.current = latest.text;
        speak(latest.text);
      }
    });
    return unsubscribe;
  }, [speak]);

  const postTranscript = useCallback(async (text: string) => {
    if (!callIdRef.current || !text.trim()) return;
    setStatus("thinking");
    try {
      const geo = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          () => resolve(null),
          { timeout: 3000 },
        );
      });
      await fetch(`${ORCHESTRATOR_URL}/voice/browser/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call_id: callIdRef.current,
          text: text.trim(),
          is_final: true,
          conversation_mode: true,
          caller_lat: geo?.coords.latitude ?? null,
          caller_lng: geo?.coords.longitude ?? null,
        }),
      });
    } catch {
      setError("Lost connection to AEGIS. Trying to keep listening.");
    }
  }, []);

  const start = useCallback(
    async (callId: string) => {
      if (!Ctor) {
        setError("This browser doesn't support voice conversation (use Chrome).");
        setStatus("error");
        return;
      }
      setError(null);
      setStatus("connecting");
      callIdRef.current = callId;
      lastAiTextRef.current = "";

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            postTranscript(result[0].transcript);
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        const recoverable = event.error === "no-speech" || event.error === "network" || event.error === "aborted";
        if (!recoverable) {
          setError(`Microphone error: ${event.error}. Trying to recover.`);
        }
      };

      recognition.onend = () => {
        // Auto-restart on silence timeout, but never while the AI is
        // speaking (speak() stops recognition deliberately and restarts
        // it itself once done) -- restarting here too would race it.
        if (recognitionRef.current === recognition && wantsListeningRef.current && !speakingRef.current) {
          try {
            recognition.start();
          } catch {
            // already started -- ignore
          }
        }
      };

      recognitionRef.current = recognition;
      wantsListeningRef.current = true;
      try {
        recognition.start();
        setStatus("listening");
      } catch {
        setError("Could not access the microphone. Check permissions and try again.");
        setStatus("error");
      }
    },
    [Ctor, postTranscript],
  );

  const stop = useCallback(() => {
    wantsListeningRef.current = false;
    window.speechSynthesis.cancel();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (callIdRef.current) {
      fetch(`${ORCHESTRATOR_URL}/voice/browser/${encodeURIComponent(callIdRef.current)}/end`, { method: "POST" }).catch(() => {});
    }
    callIdRef.current = null;
    setStatus("ended");
  }, []);

  useEffect(() => stop, [stop]);

  return { status, error, isSupported, start, stop };
}
