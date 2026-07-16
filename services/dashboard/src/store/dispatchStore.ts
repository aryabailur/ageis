import { create } from "zustand";
import { dispatch as dispatchOnce, DispatchRequest, fetchFleet, fetchNaiveBaseline, ReviewDecisionRequest, streamDispatch, submitReview } from "../api";
import type { DispatchState, FleetSnapshot, NaiveBaseline, StreamEvent } from "../types";

export interface TimelineEntry {
  node: string;
  state: DispatchState;
  ts: number;
}

interface DispatchStore {
  timeline: TimelineEntry[];
  current: DispatchState | null;
  baseline: NaiveBaseline | null;
  fleet: FleetSnapshot | null;
  isRunning: boolean;
  error: string | null;
  // Session-level counters, not derived from a single call: how many
  // dispatches this browser session has completed, and how many of those
  // never touched AWAITING_REVIEW -- the real basis for the header's
  // "autonomy %" figure.
  callsHandled: number;
  callsAutonomous: number;
  everAwaitedReview: boolean;
  /** call_id of the most recently started dispatch -- lets startDispatch
   * detect and ignore events from a run that's been superseded. */
  activeCallId: string | null;

  startDispatch: (request: DispatchRequest) => Promise<void>;
  applyReview: (decision: ReviewDecisionRequest) => Promise<void>;
  loadFleet: () => Promise<void>;
  reset: () => void;
  /** internal: not part of the public store API */
  _registerTerminal: (status: DispatchState["status"]) => void;
}

const TERMINAL_STATUSES = new Set(["DISPATCHED", "COMPLETED", "FAILED"]);

export const useDispatchStore = create<DispatchStore>((set, get) => ({
  timeline: [],
  current: null,
  baseline: null,
  fleet: null,
  isRunning: false,
  error: null,
  callsHandled: 0,
  callsAutonomous: 0,
  everAwaitedReview: false,
  activeCallId: null,

  async startDispatch(request) {
    // Guards against overlapping runs (e.g. a double-submit): every event
    // this invocation produces is tagged with its own call_id, and a
    // setter checks the store's current activeCallId before applying --
    // so a stale event from an abandoned previous run can never land on
    // top of a newer run's state, which is what let one call's ambulance
    // ID bleed into another's rendered candidates when two dispatches
    // overlapped in the same browser tab.
    const activeCallId = request.call_id;
    set({
      isRunning: true,
      error: null,
      timeline: [],
      current: null,
      baseline: null,
      everAwaitedReview: false,
      activeCallId,
    });

    const baselinePromise = fetchNaiveBaseline(request.caller_lat, request.caller_lng).catch(() => null);
    const isStale = () => get().activeCallId !== activeCallId;

    try {
      const final = await streamDispatch(request, (event: StreamEvent) => {
        if (isStale()) return;
        set((s) => ({
          timeline: [...s.timeline, { node: event.node, state: event.state, ts: Date.now() }],
          current: event.state,
          everAwaitedReview: s.everAwaitedReview || event.state.status === "AWAITING_REVIEW",
        }));
      });
      if (isStale()) return;
      set({ current: final.state, baseline: await baselinePromise });
      get()._registerTerminal(final.state.status);
    } catch (err) {
      // Streaming can fail on transports that buffer/compress the SSE
      // response (some proxies do); fall back to the plain request/response
      // endpoint rather than leaving the operator with nothing.
      try {
        const result = await dispatchOnce(request);
        const resolvedBaseline = await baselinePromise;
        if (isStale()) return;
        set((s) => ({
          current: result,
          timeline: [{ node: "dispatch", state: result, ts: Date.now() }],
          baseline: resolvedBaseline,
          everAwaitedReview: s.everAwaitedReview || result.status === "AWAITING_REVIEW",
        }));
        get()._registerTerminal(result.status);
      } catch (fallbackErr) {
        if (isStale()) return;
        set({ error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) });
      }
    } finally {
      if (!isStale()) set({ isRunning: false });
    }
  },

  async applyReview(decision) {
    const callId = get().current?.call_id;
    if (!callId) return;
    set({ isRunning: true, error: null });
    try {
      const result = await submitReview(callId, decision);
      set((s) => ({
        current: result,
        timeline: [...s.timeline, { node: "human_review", state: result, ts: Date.now() }],
      }));
      get()._registerTerminal(result.status);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isRunning: false });
    }
  },

  _registerTerminal(status: DispatchState["status"]) {
    if (!TERMINAL_STATUSES.has(status)) return;
    set((s) => ({
      callsHandled: s.callsHandled + 1,
      callsAutonomous: s.callsAutonomous + (s.everAwaitedReview ? 0 : 1),
    }));
  },

  async loadFleet() {
    try {
      set({ fleet: await fetchFleet() });
    } catch {
      // Non-critical: the map/capacity panel degrades to derived data from
      // the last dispatch's candidates when the fleet endpoint is unreachable.
    }
  },

  reset() {
    set({ timeline: [], current: null, baseline: null, error: null });
  },
}));
