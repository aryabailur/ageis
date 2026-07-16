import { useCallback, useEffect, useRef, useState } from "react";

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:8000";

// Chrome/Edge ship this under a vendor-prefixed name; Firefox/Safari
// don't implement it at all (see MDN SpeechRecognition browser support).
type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseBrowserSpeechRecognitionResult {
  isSupported: boolean;
  isListening: boolean;
  /** Real mic input level in [0, 1], for driving an honest waveform --
   * not a decorative animation. null until listening starts. */
  audioLevel: number | null;
  error: string | null;
  start: (callId: string) => Promise<void>;
  stop: () => void;
}

/**
 * Wraps the Web Speech API for continuous, interim-result transcription
 * and posts every chunk to POST /voice/browser/transcript -- the same
 * event shape and broadcast path a Twilio call produces (see
 * twilio_stream.py) -- rather than writing transcript text into any
 * store directly. That keeps voiceStore's currentTranscript sourced from
 * exactly one place (the /voice/live websocket) regardless of which
 * capture mode is active.
 */
export function useBrowserSpeechRecognition(): UseBrowserSpeechRecognitionResult {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const callIdRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Plain state is fine for rendering, but onend/onerror are closures
  // created once when `start()` runs and captured by reference on the
  // recognition object -- reading React state from inside them would
  // read whatever `isListening` was AT THAT MOMENT, not the current
  // value, so a ref is the only reliable way for those handlers to know
  // "does the user still want this running" right now.
  const wantsListeningRef = useRef(false);

  const Ctor = getSpeechRecognitionCtor();
  const isSupported = Ctor !== null;

  const postTranscript = useCallback(async (text: string, isFinal: boolean) => {
    if (!callIdRef.current || !text.trim()) return;
    try {
      await fetch(`${ORCHESTRATOR_URL}/voice/browser/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callIdRef.current, text: text.trim(), is_final: isFinal }),
      });
    } catch {
      // Best-effort: a dropped chunk just means one word gets missed in
      // the live view, not a dispatch failure -- nothing downstream has
      // run yet at this stage.
    }
  }, []);

  const stopAudioLevelMeter = useCallback(() => {
    if (analyserFrameRef.current !== null) cancelAnimationFrame(analyserFrameRef.current);
    analyserFrameRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setAudioLevel(null);
  }, []);

  const startAudioLevelMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        setAudioLevel(Math.min(1, avg / 128));
        analyserFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Mic-level metering is a nice-to-have; SpeechRecognition itself
      // requests its own mic access independently and will surface its
      // own error if the mic is unavailable.
    }
  }, []);

  const start = useCallback(
    async (callId: string) => {
      if (!Ctor) {
        setError("This browser doesn't support live speech recognition (Chrome or Edge required).");
        return;
      }
      setError(null);
      callIdRef.current = callId;

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) {
            postTranscript(text, true);
          } else {
            interim += text;
          }
        }
        if (interim) postTranscript(interim, false);
      };

      // "no-speech" (silence timeout) and "network" are routine and
      // expected during normal use -- Chrome fires them constantly on
      // any pause in talking. Only surface an error banner for failures
      // the user actually needs to act on (mic permission denied, no
      // mic hardware); recoverable ones just restart quietly via onend.
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        const recoverable = event.error === "no-speech" || event.error === "network" || event.error === "aborted";
        if (!recoverable) {
          setError(`Speech recognition error: ${event.error}`);
          wantsListeningRef.current = false;
          setIsListening(false);
        }
        // Recoverable errors: do nothing here and let onend's restart
        // logic below handle it -- Chrome always fires onend after
        // onerror, so this is not a dead end.
      };

      recognition.onend = () => {
        // Web Speech API stops after a silence timeout even in
        // continuous mode -- restart automatically while the user still
        // wants to be listening, so "live" actually stays live. Reads
        // wantsListeningRef (not React state) since this closure was
        // created once and never re-created on re-render.
        if (recognitionRef.current === recognition && wantsListeningRef.current) {
          try {
            recognition.start();
          } catch {
            // already starting/started -- ignore
          }
        }
      };

      recognitionRef.current = recognition;
      wantsListeningRef.current = true;
      try {
        recognition.start();
      } catch (err) {
        wantsListeningRef.current = false;
        recognitionRef.current = null;
        setError(`Couldn't start microphone: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      setIsListening(true);
      void startAudioLevelMeter();
    },
    [Ctor, postTranscript, startAudioLevelMeter],
  );

  const stop = useCallback(() => {
    wantsListeningRef.current = false;
    setIsListening(false);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    stopAudioLevelMeter();
    if (callIdRef.current) {
      fetch(`${ORCHESTRATOR_URL}/voice/browser/${encodeURIComponent(callIdRef.current)}/end`, { method: "POST" }).catch(() => {});
    }
    callIdRef.current = null;
  }, [stopAudioLevelMeter]);

  useEffect(() => stop, [stop]);

  return { isSupported, isListening, audioLevel, error, start, stop };
}
