import type { DispatchState } from "./types";

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:8000";

export interface DispatchRequest {
  call_id: string;
  raw_transcript: string;
  caller_lat: number;
  caller_lng: number;
}

export async function dispatch(request: DispatchRequest): Promise<DispatchState> {
  const response = await fetch(`${ORCHESTRATOR_URL}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`core_orchestrator returned ${response.status}: ${await response.text()}`);
  }
  return response.json();
}
