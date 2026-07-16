import { useCallback, useRef, useState } from "react";

export interface UseVoiceActivityDetectorResult {
  /** Real mic input level in [0, 1] -- drives the waveform honestly,
   * not a decorative animation. null when not listening. */
  audioLevel: number | null;
  /** True while the real mic level is above a speaking threshold. */
  isSpeaking: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

const SPEAKING_THRESHOLD = 0.12;

/**
 * Thin voice-activity-detection wrapper around getUserMedia + AnalyserNode --
 * the same real audio-level metering already built for
 * useBrowserSpeechRecognition.ts's waveform, extracted here so the mobile
 * call screen can drive its own waveform/speaking-state without duplicating
 * the analyser setup.
 */
export function useVoiceActivityDetector(): UseVoiceActivityDetectorResult {
  const [audioLevel, setAudioLevel] = useState<number | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    if (audioCtxRef.current) return;
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
      const level = Math.min(1, avg / 128);
      setAudioLevel(level);
      setIsSpeaking(level > SPEAKING_THRESHOLD);
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setAudioLevel(null);
    setIsSpeaking(false);
  }, []);

  return { audioLevel, isSpeaking, start, stop };
}
