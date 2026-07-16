interface ChipProps {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "error" | "info";
  pending?: boolean;
}

/**
 * Small labeled data pill used everywhere structured facts (patient
 * details, candidate metadata) would otherwise be a <dl> row or raw
 * JSON. Purely presentational -- callers still own the underlying data
 * and its live-update cadence.
 */
export function Chip({ label, value, tone = "neutral", pending = false }: ChipProps) {
  return (
    <div className={`chip chip-${tone} ${pending ? "chip-pending" : ""}`}>
      <span className="chip-label">{label}</span>
      <span className="chip-value">{value}</span>
    </div>
  );
}
