interface CircularGaugeProps {
  /** 0-100 */
  percent: number;
  label: string;
  sublabel?: string;
  tone?: "success" | "warning" | "error";
  size?: number;
}

const TONE_COLOR: Record<string, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
};

/**
 * Single-value circular progress gauge built from plain SVG stroke-dash
 * math -- no charting library. The stroke-dashoffset transition (see
 * index.css .gauge-value-ring) is what makes the ring animate smoothly
 * when `percent` changes, rather than snapping.
 */
export function CircularGauge({ percent, label, sublabel, tone = "success", size = 168 }: CircularGaugeProps) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          className="gauge-value-ring"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="gauge-center">
        <span className="gauge-value">{clamped.toFixed(0)}%</span>
        <span className="gauge-label">{label}</span>
        {sublabel && <span className="gauge-sublabel">{sublabel}</span>}
      </div>
    </div>
  );
}
