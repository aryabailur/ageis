import { FormEvent, useState } from "react";
import type { DispatchRequest } from "../api";

interface Preset {
  label: string;
  what: string;
  transcript: string;
}

const PRESETS: Preset[] = [
  {
    label: "Cardiac arrest",
    what: "Clean case — AEGIS handles it fully automatically.",
    transcript: "chest pain, left arm numb, not breathing right",
  },
  {
    label: "Major bleeding",
    what: "Trauma protocol — routes to a trauma-capable hospital.",
    transcript: "he cut his leg badly on a saw, bleeding a lot, still conscious",
  },
  {
    label: "Unclear call",
    what: "Garbled transcript — AEGIS pauses for a human to review.",
    transcript: "[static] can't hear you [inaudible]",
  },
];

function freshDemoCall(transcript: string): DispatchRequest {
  return {
    call_id: `call-${Date.now().toString(36)}`,
    raw_transcript: transcript,
    caller_lat: 42.3601,
    caller_lng: -71.0589,
  };
}

interface Props {
  onSubmit: (request: DispatchRequest) => void;
  isLoading: boolean;
}

export function DispatchForm({ onSubmit, isLoading }: Props) {
  const [form, setForm] = useState<DispatchRequest>(() => freshDemoCall(PRESETS[0].transcript));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(form);
    setForm(freshDemoCall(form.raw_transcript));
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>Simulate a 911 call</h2>
      <p className="muted panel-intro">
        No real phones involved — this sends a transcript straight into the same pipeline a real call
        would hit. Try a preset, or write your own below.
      </p>
      <div className="preset-row">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`preset-chip ${form.raw_transcript === preset.transcript ? "preset-chip-active" : ""}`}
            onClick={() => setForm({ ...form, raw_transcript: preset.transcript })}
            title={preset.what}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label>
        What the caller says
        <textarea
          rows={3}
          value={form.raw_transcript}
          onChange={(e) => setForm({ ...form, raw_transcript: e.target.value })}
        />
      </label>
      <details className="dispatch-form-advanced">
        <summary>Advanced (call ID, location)</summary>
        <div className="form-grid">
          <label>
            Call ID
            <input value={form.call_id} onChange={(e) => setForm({ ...form, call_id: e.target.value })} />
          </label>
          <label>
            Latitude
            <input
              type="number"
              step="0.0001"
              value={form.caller_lat}
              onChange={(e) => setForm({ ...form, caller_lat: Number(e.target.value) })}
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="0.0001"
              value={form.caller_lng}
              onChange={(e) => setForm({ ...form, caller_lng: Number(e.target.value) })}
            />
          </label>
        </div>
      </details>
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Dispatching…" : "Send the call"}
      </button>
    </form>
  );
}
