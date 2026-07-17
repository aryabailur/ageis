import type { CandidateAssignment, DispatchState, FleetSnapshot, Hospital, NaiveBaseline, StreamEvent, TriageResult } from "./types";

const ORCHESTRATOR_URL = import.meta.env.VITE_ORCHESTRATOR_URL ?? "http://localhost:8000";

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

// --- Dispatch History log --------------------------------------------------

/** Shape returned by GET /api/logs (list endpoint — no snapshot). */
export interface LogListItem {
  id: number;
  call_id: string;
  status: string;
  priority: string | null;
  caller_lat: number | null;
  caller_lng: number | null;
  completed_at: string; // ISO-8601 timestamp string
}

export interface LogListResponse {
  items: LogListItem[];
  count: number;
  offset: number;
  limit: number;
}

/** Shape returned by GET /api/logs/{call_id} and GET /api/logs/row/{id}. */
export interface LogDetail extends LogListItem {
  state_snapshot: DispatchState;
}

export interface LogFilters {
  status?: string;
  priority?: string;
  from_dt?: string;
  to_dt?: string;
  limit?: number;
  offset?: number;
}

export async function fetchLogs(filters: LogFilters = {}): Promise<LogListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.from_dt) params.set("from_dt", filters.from_dt);
  if (filters.to_dt) params.set("to_dt", filters.to_dt);
  if (filters.limit != null) params.set("limit", String(filters.limit));
  if (filters.offset != null) params.set("offset", String(filters.offset));
  const url = `${ORCHESTRATOR_URL}/api/logs${params.size ? "?" + params.toString() : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`log list fetch failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchLog(callId: string): Promise<LogDetail> {
  const response = await fetch(`${ORCHESTRATOR_URL}/api/logs/${encodeURIComponent(callId)}`);
  if (!response.ok) {
    throw new Error(`log fetch failed: ${response.status}`);
  }
  return response.json();
}

export async function fetchLogById(logId: number): Promise<LogDetail> {
  const response = await fetch(`${ORCHESTRATOR_URL}/api/logs/row/${logId}`);
  if (!response.ok) {
    throw new Error(`log fetch by id failed: ${response.status}`);
  }
  return response.json();
}

