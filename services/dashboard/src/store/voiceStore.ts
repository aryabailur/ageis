import { create } from "zustand";
import { getOrchestratorUrl } from "../api";

const ORCHESTRATOR_URL = getOrchestratorUrl();
// Empty VITE_ORCHESTRATOR_URL means "same origin, Vite proxies to the
// backend" (see vite.config.ts) -- fetches go relative automatically, but
// the WebSocket constructor needs an absolute URL, so derive it from the
// page's own origin (wss:// when the page is https, e.g. via ngrok).
const ORCHESTRATOR_WS_URL = ORCHESTRATOR_URL
  ? ORCHESTRATOR_URL.replace(/^http/, "ws")
  : window.location.origin.replace(/^http/, "ws");

export type VoiceCallStatus = "idle" | "connecting" | "in_progress" | "ended" | "ready_for_dispatch";
export type VoiceSource = "browser" | "twilio" | "ai";

export interface PatientDetails {
  name?: string | null;
  age?: number | null;
  phone?: string | null;
  symptoms?: string | null;
  location_text?: string | null;
  emergency_type?: string | null;
  breathing?: "normal" | "abnormal" | "unknown" | null;
  conscious?: boolean | null;
  victims?: number | null;
  severity?: "critical" | "serious" | "moderate" | "minor" | null;
  confidence?: number | null;
}

export interface ConversationMessage {
  role: "ai" | "patient";
  text: string;
  ts: number;
}

interface VoiceLiveEvent {
  type: "transcript_update" | "call_status" | "patient_extraction" | "dispatch_update";
  call_id: string;
  text?: string;
  is_final?: boolean;
  status?: VoiceCallStatus;
  caller_number?: string | null;
  duration_s?: number | null;
  source?: VoiceSource;
  patient_details?: PatientDetails;
  is_complete?: boolean;
  ready_for_dispatch?: boolean;
  raw_transcript?: string;
  caller_lat?: number | null;
  caller_lng?: number | null;
}

interface VoiceStore {
  /** Finalized transcript text accumulated so far for the active call.
   * Kept as a first-class, plainly-named field (per spec) so any future
   * module can read it without knowing anything about voice/websocket
   * plumbing -- this is the ONLY thing downstream code should depend on. */
  currentTranscript: string;
  interimText: string;
  callId: string | null;
  callerNumber: string | null;
  callStatus: VoiceCallStatus;
  callDurationS: number;
  source: VoiceSource | null;
  isSocketConnected: boolean;
  /** Caller's GPS coordinates — populated as soon as the first call_status
   * event arrives with location data, so the map can show the patient pin
   * during the live conversation before dispatch runs. */
  callerLat: number | null;
  callerLng: number | null;
  /** Live patient-detail extraction from the AI conversation feature.
   * Additive: only populated when conversation_mode is used; the
   * existing manual browser-mic / Twilio flows never touch this. */
  patientDetails: PatientDetails;
  /** Turn-by-turn AI/patient message log, for ConversationTranscriptCard --
   * distinct from currentTranscript, which stays the single running blob
   * IncomingCallCard already renders. */
  conversationMessages: ConversationMessage[];
  readyForDispatch: boolean;
  /** Set once, the instant the AI conversation decides it has enough
   * info -- App.tsx's effect consumes this and clears it via
   * clearDispatchReadyPayload() so a dispatch is triggered exactly
   * once per completed conversation, not on every re-render. */
  dispatchReadyPayload: { call_id: string; raw_transcript: string; caller_lat: number; caller_lng: number } | null;
  clearDispatchReadyPayload: () => void;

  connect: () => void;
  disconnect: () => void;
  reset: () => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export const useVoiceStore = create<VoiceStore>((set, get) => ({
  currentTranscript: "",
  interimText: "",
  callId: null,
  callerNumber: null,
  callStatus: "idle",
  callDurationS: 0,
  source: null,
  isSocketConnected: false,
  callerLat: null,
  callerLng: null,
  patientDetails: {},
  conversationMessages: [],
  readyForDispatch: false,
  dispatchReadyPayload: null,

  clearDispatchReadyPayload() {
    set({ dispatchReadyPayload: null });
  },

  connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

    const ws = new WebSocket(`${ORCHESTRATOR_WS_URL}/voice/live`);
    socket = ws;

    ws.onopen = () => set({ isSocketConnected: true });

    ws.onmessage = (event) => {
      let payload: VoiceLiveEvent;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      if (payload.type === "call_status") {
        set((s) => ({
          callId: payload.call_id,
          callStatus: payload.status ?? s.callStatus,
          callerNumber: payload.caller_number ?? s.callerNumber,
          callDurationS: payload.duration_s ?? s.callDurationS,
          source: payload.source ?? s.source,
          readyForDispatch: payload.ready_for_dispatch ?? s.readyForDispatch,
          // Capture coords as soon as they arrive so the map can show the
          // patient pin during the live call, before dispatch runs.
          callerLat: payload.caller_lat != null ? payload.caller_lat : s.callerLat,
          callerLng: payload.caller_lng != null ? payload.caller_lng : s.callerLng,
          dispatchReadyPayload: payload.ready_for_dispatch
            ? {
                call_id: payload.call_id,
                raw_transcript: payload.raw_transcript ?? "",
                caller_lat: payload.caller_lat ?? 0,
                caller_lng: payload.caller_lng ?? 0,
              }
            : s.dispatchReadyPayload,
        }));
        return;
      }

      if (payload.type === "transcript_update") {
        set((s) => {
          const message: ConversationMessage | null =
            payload.source === "ai" || payload.source === "browser"
              ? { role: payload.source === "ai" ? "ai" : "patient", text: payload.text ?? "", ts: Date.now() }
              : null;
          const conversationMessages =
            message && payload.is_final ? [...s.conversationMessages, message] : s.conversationMessages;

          const isAi = payload.source === "ai";

          if (payload.is_final) {
            return {
              callId: payload.call_id,
              currentTranscript: isAi
                ? s.currentTranscript
                : `${s.currentTranscript} ${payload.text ?? ""}`.trim(),
              interimText: isAi ? s.interimText : "",
              source: (payload.source && payload.source !== "ai") ? payload.source : s.source,
              conversationMessages,
            };
          }
          return {
            callId: payload.call_id,
            interimText: isAi ? s.interimText : (payload.text ?? ""),
            source: (payload.source && payload.source !== "ai") ? payload.source : s.source,
          };
        });
        return;
      }

      if (payload.type === "patient_extraction") {
        set((s) => ({
          callId: payload.call_id,
          patientDetails: { ...s.patientDetails, ...payload.patient_details },
          readyForDispatch: payload.is_complete ?? s.readyForDispatch,
        }));
      }
    };

    ws.onclose = () => {
      set({ isSocketConnected: false });
      if (socket === ws) {
        socket = null;
        // Auto-reconnect: this socket has no user-facing "retry" affordance,
        // and a dropped connection during a live call would otherwise
        // silently stop transcript updates with no way to recover short of
        // a page reload.
        reconnectTimer = setTimeout(() => get().connect(), 2000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  },

  disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
    socket = null;
    set({ isSocketConnected: false });
  },

  reset() {
    set({
      currentTranscript: "",
      interimText: "",
      callId: null,
      callerNumber: null,
      callStatus: "idle",
      callDurationS: 0,
      source: null,
      callerLat: null,
      callerLng: null,
      patientDetails: {},
      conversationMessages: [],
      readyForDispatch: false,
    });
  },
}));
