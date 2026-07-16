import { FormEvent, useState } from "react";
import type { DispatchRequest } from "../api";

const DEMO_CARDIAC: DispatchRequest = {
  call_id: "call-demo-001",
  raw_transcript: "chest pain, left arm numb, not breathing right",
  caller_lat: 42.3601,
  caller_lng: -71.0589,
};

interface Props {
  onSubmit: (request: DispatchRequest) => void;
  isLoading: boolean;
}

export function DispatchForm({ onSubmit, isLoading }: Props) {
  const [form, setForm] = useState<DispatchRequest>(DEMO_CARDIAC);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <h2>New Call</h2>
      <div className="form-grid">
        <label>
          Call ID
          <input
            value={form.call_id}
            onChange={(e) => setForm({ ...form, call_id: e.target.value })}
          />
        </label>
        <label>
          Caller latitude
          <input
            type="number"
            step="0.0001"
            value={form.caller_lat}
            onChange={(e) => setForm({ ...form, caller_lat: Number(e.target.value) })}
          />
        </label>
        <label>
          Caller longitude
          <input
            type="number"
            step="0.0001"
            value={form.caller_lng}
            onChange={(e) => setForm({ ...form, caller_lng: Number(e.target.value) })}
          />
        </label>
      </div>
      <label>
        Transcript
        <textarea
          rows={3}
          value={form.raw_transcript}
          onChange={(e) => setForm({ ...form, raw_transcript: e.target.value })}
        />
      </label>
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Dispatching..." : "Dispatch"}
      </button>
    </form>
  );
}
