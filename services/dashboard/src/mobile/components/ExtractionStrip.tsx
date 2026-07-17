import { useEffect, useState } from "react";
import type { PatientDetails } from "../../store/voiceStore";

interface Chip {
  key: keyof PatientDetails;
  icon: string;
  label: string;
  value: string | null;
}

function buildChips(details: PatientDetails): Chip[] {
  return [
    { key: "emergency_type", icon: "🏥", label: "Type", value: details.emergency_type ?? null },
    {
      key: "breathing",
      icon: "🫁",
      label: "Breathing",
      value: details.breathing && details.breathing !== "unknown" ? details.breathing : null,
    },
    {
      key: "conscious",
      icon: "👁",
      label: "Conscious",
      value: details.conscious == null ? null : details.conscious ? "yes" : "no",
    },
    { key: "location_text", icon: "📍", label: "Location", value: details.location_text ?? null },
    { key: "age", icon: "👤", label: "Age", value: details.age != null ? String(details.age) : null },
  ];
}

interface ExtractionChipProps {
  chip: Chip;
}

/** Animates in (opacity/scale) the first time a chip's value goes from
 * null to known -- tracks its own "have I already animated" flag so it
 * doesn't replay every time the parent re-renders for an unrelated field. */
function ExtractionChip({ chip }: ExtractionChipProps) {
  const [entered, setEntered] = useState(chip.value !== null);

  useEffect(() => {
    if (chip.value !== null) setEntered(true);
  }, [chip.value]);

  return (
    <div className={`mobile-chip ${chip.value !== null ? "mobile-chip-filled" : ""} ${entered && chip.value !== null ? "mobile-chip-enter" : ""}`}>
      <span className="mobile-chip-icon" aria-hidden="true">
        {chip.icon}
      </span>
      <span className="mobile-chip-value">{chip.value ?? "—"}</span>
    </div>
  );
}

interface ExtractionStripProps {
  patientDetails: PatientDetails;
}

export function ExtractionStrip({ patientDetails }: ExtractionStripProps) {
  const chips = buildChips(patientDetails);
  return (
    <div className="mobile-extraction-strip">
      {chips.map((chip) => (
        <ExtractionChip key={chip.key} chip={chip} />
      ))}
    </div>
  );
}
