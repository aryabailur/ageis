import type { TimelineEntry } from "../store/dispatchStore";
import type { DispatchState } from "../types";

interface StepDef {
  id: string;
  label: string;
  /** Node names (from SSE events) OR timing_log step names that count as
   * this step having started. */
  nodes: string[];
  doneOn: string;
}

const STEPS: StepDef[] = [
  { id: "call", label: "Incoming call", nodes: ["ingest_call"], doneOn: "ingest_call" },
  { id: "medical", label: "Medical analysis", nodes: ["extract_incident"], doneOn: "extract_incident" },
  { id: "priority", label: "Priority assigned", nodes: ["apply_triage_rules"], doneOn: "apply_triage_rules" },
  {
    id: "ranked",
    label: "Hospital ranked",
    nodes: ["load_resources", "compute_route_estimates", "rank_assignments", "reverify_candidate"],
    doneOn: "rank_assignments",
  },
  { id: "selected", label: "Ambulance selected", nodes: ["finalize_ranking"], doneOn: "finalize_ranking" },
  { id: "route", label: "Route planned", nodes: ["validate_proposal"], doneOn: "validate_proposal" },
  { id: "dispatched", label: "Dispatch sent", nodes: ["reserve_ambulance", "validate_reservation"], doneOn: "validate_reservation" },
  { id: "enroute", label: "Ambulance en route", nodes: ["simulate_dispatch"], doneOn: "simulate_dispatch" },
  { id: "ready", label: "Hospital ready", nodes: ["monitor_or_finish"], doneOn: "monitor_or_finish" },
];

const TERMINAL_STATUSES = new Set(["COMPLETED", "DISPATCHED", "FAILED", "AWAITING_REVIEW"]);

function stepStatus(
  step: StepDef,
  seenNodes: Set<string>,
  timingSteps: Set<string>,
  isTerminal: boolean,
): "pending" | "active" | "done" {
  if (seenNodes.has(step.doneOn) || timingSteps.has(step.doneOn)) return "done";
  const started = step.nodes.some((n) => seenNodes.has(n) || timingSteps.has(n));
  if (started) return isTerminal ? "done" : "active";
  return "pending";
}

/**
 * Visual replacement for the plain timing-log table: the same call
 * lifecycle rendered as a vertical step flow, each node lighting up as
 * its corresponding graph node completes. Reuses the exact same
 * timeline/timing_log data AgentReasoningPanel already reads -- no new
 * state, no new events.
 */
export function DecisionTimeline({ timeline, current }: { timeline: TimelineEntry[]; current: DispatchState | null }) {
  const seenNodes = new Set(timeline.map((t) => t.node));
  const timingSteps = new Set((current?.timing_log ?? []).map((e) => e.step));
  const isTerminal = current !== null && TERMINAL_STATUSES.has(current.status);

  if (!current) {
    return (
      <div className="decision-timeline decision-timeline-empty">
        <span className="muted">Timeline will populate once a call comes in.</span>
      </div>
    );
  }

  return (
    <div className="decision-timeline">
      {STEPS.map((step) => {
        const status = stepStatus(step, seenNodes, timingSteps, isTerminal);
        return (
          <div key={step.id} className={`decision-step decision-step-${status}`}>
            <span className="decision-step-dot" />
            <span className="decision-step-label">{step.label}</span>
          </div>
        );
      })}
    </div>
  );
}
