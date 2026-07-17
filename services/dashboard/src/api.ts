import type { CandidateAssignment, DispatchState, FleetSnapshot, Hospital, NaiveBaseline, StreamEvent, TriageResult } from "./types";

export function getOrchestratorUrl(): string {
  const envUrl = import.meta.env.VITE_ORCHESTRATOR_URL;
  if (envUrl === "") {
    return "";
  }
  const url = envUrl ?? "http://localhost:8000";
  const hostname = window.location.hostname;
  return url.replace("localhost", hostname).replace("127.0.0.1", hostname);
}

const ORCHESTRATOR_URL = getOrchestratorUrl();

export interface DispatchRequest {
  call_id: string;
  raw_transcript: string;
  caller_lat: number;
  caller_lng: number;
}

export interface ReviewDecisionRequest {
  decision: "APPROVE" | "OVERRIDE";
  triage_override?: TriageResult;
  selected_override?: CandidateAssignment;
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

/**
 * Streams /dispatch/stream's SSE events as they arrive. EventSource can't
 * send a POST body, so this reads the fetch Response body as a stream and
 * parses the `data: {...}\n\n` frames by hand -- a small, well-understood
 * parser rather than pulling in an SSE client library for one endpoint.
 * onEvent fires once per LangGraph node completion; the returned promise
 * resolves with the final event once the stream closes.
 */
export async function streamDispatch(
  request: DispatchRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<StreamEvent> {
  const response = await fetch(`${ORCHESTRATOR_URL}/dispatch/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`core_orchestrator stream returned ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEvent: StreamEvent | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const event = JSON.parse(line.slice(5).trim()) as StreamEvent;
      lastEvent = event;
      onEvent(event);
    }
  }

  if (!lastEvent) {
    throw new Error("dispatch stream closed with no events");
  }
  return lastEvent;
}

export async function submitReview(callId: string, decision: ReviewDecisionRequest): Promise<DispatchState> {
  const response = await fetch(`${ORCHESTRATOR_URL}/dispatch/${encodeURIComponent(callId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(decision),
  });
  if (!response.ok) {
    throw new Error(`review submission failed: ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export async function fetchFleet(): Promise<FleetSnapshot> {
  const response = await fetch(`${ORCHESTRATOR_URL}/admin/fleet`);
  if (!response.ok) {
    throw new Error(`fleet fetch failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchNaiveBaseline(lat: number, lng: number): Promise<NaiveBaseline> {
  const response = await fetch(`${ORCHESTRATOR_URL}/baseline?lat=${lat}&lng=${lng}`);
  if (!response.ok) {
    throw new Error(`baseline fetch failed: ${response.status}`);
  }
  return response.json();
}

export async function setHospitalStatus(hospitalId: string, status: "OPEN" | "DIVERSION"): Promise<Hospital> {
  const response = await fetch(`${ORCHESTRATOR_URL}/admin/hospitals/${hospitalId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) {
    throw new Error(`status update failed: ${response.status}: ${await response.text()}`);
  }
  return response.json();
}
