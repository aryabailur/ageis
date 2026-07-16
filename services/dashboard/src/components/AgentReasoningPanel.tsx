import type { TimelineEntry } from "../store/dispatchStore";
import type { DispatchState } from "../types";
import { hospitalDisplayName, specialtyLabel } from "../glossary";

interface StageDef {
  id: string;
  label: string;
  what: string;
  icon: string;
  // Node names that count as this stage having started/progressed.
  nodes: string[];
  // Node whose completion means this stage is fully done.
  doneOn: string;
}

const STAGES: StageDef[] = [
  {
    id: "triage",
    label: "Assess severity",
    what: "Reads the transcript and classifies how urgent this is.",
    icon: "♥",
    nodes: ["extract_incident", "apply_triage_rules"],
    doneOn: "apply_triage_rules",
  },
  {
    id: "resource",
    label: "Pick the best unit + hospital",
    what: "Scores every nearby ambulance/hospital pairing by drive time and capability.",
    icon: "⌂",
    nodes: ["load_resources", "compute_route_estimates", "rank_assignments", "reverify_candidate", "finalize_ranking"],
    doneOn: "finalize_ranking",
  },
  {
    id: "dispatch",
    label: "Confirm & dispatch",
    what: "Locks the reservation and sends the unit — auto-recovers if a hospital drops out mid-flight.",
    icon: "⇄",
    nodes: ["validate_proposal", "reserve_ambulance", "validate_reservation", "simulate_dispatch"],
    doneOn: "simulate_dispatch",
  },
  {
    id: "comms",
    label: "Coach the caller",
    what: "Reads live first-aid instructions to the caller while help is on the way.",
    icon: "▤",
    nodes: ["dispatch_prearrival_guidance"],
    doneOn: "dispatch_prearrival_guidance",
  },
];

const TERMINAL_STATUSES = new Set(["COMPLETED", "DISPATCHED", "FAILED", "AWAITING_REVIEW"]);

/**
 * Node-name presence covers the streamed case (each SSE event names the
 * node that just ran). A review-resume POST returns one final state with
 * no per-node events, so timing_log -- which every node appends to,
 * streamed or not -- is the fallback source of truth for "did this stage
 * actually run", keeping the panel accurate after Approve/Override too.
 *
 * isTerminal covers the case where the run reached FAILED (or another
 * terminal status) WITHOUT ever completing a stage it had started --
 * e.g. every ambulance in the fleet was already booked, so
 * reserve_ambulance started but simulate_dispatch never ran. Without
 * this, "Confirm & dispatch" would show "running..." forever instead of
 * reflecting that the run actually stopped there.
 */
function stageStatus(
  stage: StageDef,
  seenNodes: Set<string>,
  timingSteps: Set<string>,
  isTerminal: boolean,
): "pending" | "running" | "done" | "stopped" {
  if (seenNodes.has(stage.doneOn) || timingSteps.has(stage.doneOn)) return "done";
  const started = stage.nodes.some((n) => seenNodes.has(n) || timingSteps.has(n));
  if (started) return isTerminal ? "stopped" : "running";
  return "pending";
}

function triageDetail(state: DispatchState | null): string | null {
  if (!state?.triage) return null;
  if (state.triage.priority === "UNKNOWN") return "Couldn't classify — flagged for human review";
  const specialty = state.triage.required_hospital_specialty
    ? `, needs ${specialtyLabel(state.triage.required_hospital_specialty).toLowerCase()} care`
    : "";
  return `${state.triage.priority} — ${state.triage.priority === "P1" ? "critical" : state.triage.priority === "P2" ? "serious" : "stable"}${specialty}`;
}

function resourceDetail(state: DispatchState | null): string | null {
  if (!state?.selected) {
    if (state?.candidates?.length) return `${state.candidates.length} option${state.candidates.length === 1 ? "" : "s"} evaluated`;
    return null;
  }
  return `${hospitalDisplayName(state.selected.hospital.id)} · ${state.selected.hospital.bed_count} beds open`;
}

function dispatchDetail(state: DispatchState | null): string | null {
  if (!state?.selected) return null;
  const unit = state.selected.ambulance.id.replace("unit-", "Unit ");
  if (state.reservation?.confirmed) return `${unit} · reservation confirmed`;
  return `${unit} · fastest option by drive time`;
}

function commsDetail(state: DispatchState | null): string | null {
  if (!state?.prearrival) return null;
  return state.prearrival.metronome_bpm ? `reading ${state.prearrival.protocol_id.toLowerCase().replace(/_/g, " ")} aloud` : state.prearrival.protocol_id.toLowerCase().replace(/_/g, " ");
}

const DETAIL_FNS: Record<string, (state: DispatchState | null) => string | null> = {
  triage: triageDetail,
  resource: resourceDetail,
  dispatch: dispatchDetail,
  comms: commsDetail,
};

const STATUS_TEXT: Record<string, string> = {
  done: "done",
  running: "running…",
  stopped: "didn't finish",
  pending: "pending",
};

export function AgentReasoningPanel({ timeline, current }: { timeline: TimelineEntry[]; current: DispatchState | null }) {
  const seenNodes = new Set(timeline.map((t) => t.node));
  const timingSteps = new Set((current?.timing_log ?? []).map((e) => e.step));
  const isTerminal = current !== null && TERMINAL_STATUSES.has(current.status);

  return (
    <div className="card reasoning-card">
      <h2>What AEGIS is doing</h2>
      <p className="muted panel-intro">Four automated steps run in order for every 911 call, no human needed unless something's unclear.</p>
      <div className="reasoning-list">
        {STAGES.map((stage) => {
          const status = stageStatus(stage, seenNodes, timingSteps, isTerminal);
          const detail = DETAIL_FNS[stage.id](current);
          return (
            <div key={stage.id} className={`reasoning-row reasoning-row-${status}`}>
              <div className="reasoning-row-top">
                <span className="reasoning-icon">{stage.icon}</span>
                <span className="reasoning-label">{stage.label}</span>
                <span className={`reasoning-status reasoning-status-${status}`}>{STATUS_TEXT[status]}</span>
              </div>
              <div className="reasoning-what">{stage.what}</div>
              {status === "running" && <div className="reasoning-progress-track"><div className="reasoning-progress-fill" /></div>}
              {detail && <div className="reasoning-detail">{detail}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
