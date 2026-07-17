import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceStore } from "../store/voiceStore";
import { getOrchestratorUrl } from "../api";

const ORCHESTRATOR_URL = getOrchestratorUrl();

// The AI's reply arrives over a separate WebSocket (voiceStore's
// /voice/live), not as the direct response to postTranscript's fetch --
// if that socket drops/reconnects at exactly the wrong moment, the
// broadcast is lost with nothing to retry it, and "thinking" would
// otherwise hang forever with no visible signal. This bounds the wait.
const THINKING_TIMEOUT_MS = 15_000;
const VOICE_SOCKET_TIMEOUT_MS = 5_000;

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
  isMuted: boolean;
  start: (callId: string) => Promise<void>;
  stop: () => void;
  setMuted: (muted: boolean) => void;
}

function waitForVoiceSocket(): Promise<boolean> {
  if (useVoiceStore.getState().isSocketConnected) return Promise.resolve(true);
  useVoiceStore.getState().connect();
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      resolve(connected);
    };
    const unsubscribe = useVoiceStore.subscribe((state) => {
      if (state.isSocketConnected) finish(true);
    });
    timeout = setTimeout(() => finish(false), VOICE_SOCKET_TIMEOUT_MS);
  });
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
  const [isMuted, setIsMutedState] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const callIdRef = useRef<string | null>(null);
  const wantsListeningRef = useRef(false);
  const speakingRef = useRef(false);
  const lastAiTextRef = useRef<string>("");
  const thinkingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumulatedTranscriptRef = useRef<string>("");
  const postTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedIndexRef = useRef<number>(-1);

  const clearThinkingTimeout = useCallback(() => {
    if (thinkingTimeoutRef.current) {
      clearTimeout(thinkingTimeoutRef.current);
      thinkingTimeoutRef.current = null;
    }
  }, []);

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
      const isReady = useVoiceStore.getState().readyForDispatch;
      if (isReady) {
        wantsListeningRef.current = false;
        clearThinkingTimeout();
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        if (callIdRef.current) {
          fetch(`${ORCHESTRATOR_URL}/voice/browser/${encodeURIComponent(callIdRef.current)}/end`, { method: "POST" }).catch(() => {});
        }
        callIdRef.current = null;
        setStatus("ended");
      } else if (wantsListeningRef.current) {
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
      const isReady = useVoiceStore.getState().readyForDispatch;
      if (isReady) {
        wantsListeningRef.current = false;
        clearThinkingTimeout();
        recognitionRef.current?.stop();
        recognitionRef.current = null;
        if (callIdRef.current) {
          fetch(`${ORCHESTRATOR_URL}/voice/browser/${encodeURIComponent(callIdRef.current)}/end`, { method: "POST" }).catch(() => {});
        }
        callIdRef.current = null;
        setStatus("ended");
      } else if (wantsListeningRef.current) {
        setStatus("listening");
        try {
          recognitionRef.current?.start();
        } catch {
          // ignore
        }
      }
    };

    window.speechSynthesis.speak(utterance);
  }, [clearThinkingTimeout]);

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
        clearThinkingTimeout();
        speak(latest.text);
      }
    });
    return unsubscribe;
  }, [speak, clearThinkingTimeout]);

  const postTranscript = useCallback(
    async (text: string) => {
      if (!callIdRef.current || !text.trim()) return;
      setStatus("thinking");
      clearThinkingTimeout();
      // The AI's reply arrives asynchronously over voiceStore's /voice/live
      // socket, not as this fetch's response -- if that broadcast never
      // arrives (a dropped/reconnecting socket at the wrong moment), this
      // is what stops "thinking" from hanging forever with no recovery.
      thinkingTimeoutRef.current = setTimeout(() => {
        if (wantsListeningRef.current && !speakingRef.current) {
          setError("AEGIS didn't reply in time. Please try again.");
          setStatus("listening");
          try {
            recognitionRef.current?.start();
          } catch {
            // already started -- ignore
          }
        }
      }, THINKING_TIMEOUT_MS);

      try {
        const geo = await new Promise<GeolocationPosition | null>((resolve) => {
          if (!navigator.geolocation) return resolve(null);
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos),
            () => resolve(null),
            { timeout: 3000 },
          );
        });
        const res = await fetch(`${ORCHESTRATOR_URL}/voice/browser/transcript`, {
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
        const data = await res.json();
        if (data.status === "ok" && data.ai_reply) {
          // Fallback: manually commit the AI reply and extraction results to the store
          // to guarantee the UI updates and voice speaks even if the WebSocket drops.
          useVoiceStore.setState((s) => {
            const alreadyExists = s.conversationMessages.some(
              (m) => m.role === "ai" && m.text === data.ai_reply
            );
            if (alreadyExists) return {};

            const aiMessage = { role: "ai" as const, text: data.ai_reply, ts: Date.now() };
            return {
              conversationMessages: [...s.conversationMessages, aiMessage],
              patientDetails: { ...s.patientDetails, ...data.patient_details },
              readyForDispatch: data.is_complete ?? s.readyForDispatch,
              dispatchReadyPayload: data.is_complete
                ? {
                    call_id: callIdRef.current!,
                    raw_transcript: s.currentTranscript + " " + text.trim(),
                    caller_lat: geo?.coords.latitude ?? 0,
                    caller_lng: geo?.coords.longitude ?? 0,
                  }
                : s.dispatchReadyPayload,
            };
          });
        }
      } catch {
        clearThinkingTimeout();
        setError("Lost connection to AEGIS. Trying to keep listening.");
      }
    },
    [clearThinkingTimeout],
  );

  const debouncePostTranscript = useCallback(
    (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) return;

      const currentAcc = accumulatedTranscriptRef.current;
      if (cleanText.toLowerCase().startsWith(currentAcc.toLowerCase())) {
        accumulatedTranscriptRef.current = cleanText;
      } else {
        accumulatedTranscriptRef.current = `${currentAcc} ${cleanText}`.trim();
      }

      if (postTimeoutRef.current) {
        clearTimeout(postTimeoutRef.current);
      }
      postTimeoutRef.current = setTimeout(() => {
        postTranscript(accumulatedTranscriptRef.current);
        accumulatedTranscriptRef.current = "";
        postTimeoutRef.current = null;
      }, 1200);
    },
    [postTranscript],
  );

  const start = useCallback(
    async (callId: string) => {
      if (!Ctor) {
        setError("This browser doesn't support voice conversation (use Chrome).");
        setStatus("error");
        return;
      }
      setError(null);
      setStatus("connecting");
      setIsMutedState(false);
      callIdRef.current = callId;
      lastAiTextRef.current = "";
      lastProcessedIndexRef.current = -1;

      // Unlock SpeechSynthesis for mobile browsers
      if (typeof window !== "undefined" && window.speechSynthesis) {
        try {
          const silentUtterance = new SpeechSynthesisUtterance(" ");
          silentUtterance.volume = 0;
          window.speechSynthesis.speak(silentUtterance);
        } catch (e) {
          console.warn("Failed to play silent utterance for SpeechSynthesis unlock:", e);
        }
      }

      if (!(await waitForVoiceSocket())) {
        setError("Could not connect to the AEGIS voice service. Make sure the backend is running and try again.");
        setStatus("error");
        callIdRef.current = null;
        return;
      }

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal && i > lastProcessedIndexRef.current) {
            lastProcessedIndexRef.current = i;
            debouncePostTranscript(result[0].transcript);
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // Recoverable types (no-speech/network/aborted) are otherwise
        // completely silent to the user -- logging every error, even
        // recoverable ones, is what let us tell a real stuck-listening
        // bug apart from normal silence during on-device debugging.
        console.warn("[AEGIS] SpeechRecognition error:", event.error, event.message);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          wantsListeningRef.current = false;
          setError("Microphone permission was denied. Allow microphone access in your browser, then try again.");
          setStatus("error");
          return;
        }
        if (event.error === "audio-capture") {
          wantsListeningRef.current = false;
          setError("No working microphone was found. Connect or enable a microphone, then try again.");
          setStatus("error");
          return;
        }
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
        wantsListeningRef.current = false;
        setError("Could not access the microphone. Check permissions and try again.");
        setStatus("error");
      }
    },
    [Ctor, debouncePostTranscript],
  );

  const stop = useCallback(() => {
    wantsListeningRef.current = false;
    clearThinkingTimeout();
    if (postTimeoutRef.current) {
      clearTimeout(postTimeoutRef.current);
      postTimeoutRef.current = null;
    }
    accumulatedTranscriptRef.current = "";
    window.speechSynthesis.cancel();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (callIdRef.current) {
      fetch(`${ORCHESTRATOR_URL}/voice/browser/${encodeURIComponent(callIdRef.current)}/end`, { method: "POST" }).catch(() => {});
    }
    callIdRef.current = null;
    setIsMutedState(false);
    setStatus("ended");
  }, [clearThinkingTimeout]);

  const setMuted = useCallback((muted: boolean) => {
    if (!recognitionRef.current || !callIdRef.current) return;
    setIsMutedState(muted);
    wantsListeningRef.current = !muted;
    if (muted) {
      recognitionRef.current.stop();
      return;
    }
    setError(null);
    setStatus("listening");
    try {
      recognitionRef.current.start();
    } catch {
      // The recognizer may already be transitioning back to started.
    }
  }, []);

  useEffect(() => stop, [stop]);

  return { status, error, isSupported, isMuted, start, stop, setMuted };
}
