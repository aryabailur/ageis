interface WaveformProps {
  /** Real mic level in [0, 1], or null when idle. Honest signal, not a
   * fake looping animation -- driven by useVoiceActivityDetector /
   * useConversationOrchestrator's underlying analyser. */
  level: number | null;
  active: boolean;
}

const BAR_COUNT = 24;

/** Deterministic per-bar weighting so bars don't all move in lockstep --
 * still driven entirely by the single real `level` value, just spread
 * across bars for a natural look instead of one flat block. */
const BAR_WEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.3)));

export function Waveform({ level, active }: WaveformProps) {
  const effectiveLevel = active ? (level ?? 0) : 0;
  return (
    <div className="mobile-waveform" aria-hidden="true">
      {BAR_WEIGHTS.map((weight, i) => {
        const height = Math.max(6, effectiveLevel * weight * 100);
        return <span key={i} className="mobile-waveform-bar" style={{ height: `${height}%` }} />;
      })}
    </div>
  );
}
