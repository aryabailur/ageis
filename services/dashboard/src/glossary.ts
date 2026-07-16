/**
 * Plain-English translations for the domain/engineering terms the
 * backend contract uses verbatim (rule IDs, graph node names, protocol
 * codes). Centralized here so every panel says the same thing for the
 * same underlying value -- and so a reviewer unfamiliar with EMS/graph
 * terminology can follow the dashboard without a glossary of their own.
 */

export const ALS_EXPLAINER = "ALS = Advanced Life Support: a paramedic-staffed unit that can give IV medication, intubate, and run cardiac drugs — not just a basic first-aid crew (BLS).";
export const BLS_EXPLAINER = "BLS = Basic Life Support: an EMT crew trained in CPR, oxygen, and splinting, but not authorized for IV medication or advanced airway procedures.";

export const SPECIALTY_LABELS: Record<string, string> = {
  cardiac: "Cardiac / heart",
  trauma: "Trauma / surgical",
  stroke: "Stroke / neuro",
  general: "General ER",
};

export function specialtyLabel(specialty: string | null): string {
  if (!specialty) return "Any ER";
  return SPECIALTY_LABELS[specialty] ?? specialty;
}

export const PRIORITY_LABELS: Record<string, string> = {
  P1: "Critical — life-threatening",
  P2: "Serious — urgent",
  P3: "Stable — routine",
  UNKNOWN: "Unclear — needs a human",
};

const RULE_LABELS: Record<string, string> = {
  RULE_CARDIAC_NOT_BREATHING: "Chest pain + not breathing normally → treat as cardiac arrest",
  RULE_CARDIAC_STABLE: "Chest pain, breathing normally → stable cardiac case",
  RULE_MAJOR_BLEEDING: "Major bleeding reported → trauma protocol",
  RULE_CHOKING: "Choking reported → airway protocol",
  RULE_UNKNOWN_OR_GARBLED: "Transcript unclear or complaint not recognized",
  RULE_DEFAULT_STABLE: "No red-flag symptoms detected → routine transport",
};

export function ruleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleId.replace(/^RULE_/, "").replace(/_/g, " ").toLowerCase();
}

const REJECTION_LABELS: Record<string, string> = {
  ALS_REQUIRED: "Doesn't have a paramedic crew (this case needs one)",
  SPECIALTY_REQUIRED: "Hospital can't treat this condition",
  HOSPITAL_DIVERSION: "Hospital is on diversion (not taking patients right now)",
  NO_BEDS: "Hospital has no open beds",
};

export function rejectionLabel(reasonCode: string, fallback: string): string {
  return REJECTION_LABELS[reasonCode] ?? fallback;
}

/** Graph node name -> plain-English step label, used by TimingBreakdown. */
const STEP_LABELS: Record<string, string> = {
  ingest_call: "Call received",
  extract_incident: "Understand what happened",
  apply_triage_rules: "Classify severity",
  dispatch_prearrival_guidance: "Start phone coaching",
  load_resources: "Find nearby units & hospitals",
  compute_route_estimates: "Calculate drive times",
  rank_assignments: "Score every option",
  reverify_candidate: "Double-check a close call",
  finalize_ranking: "Pick the best match",
  validate_proposal: "Confirm the match is still valid",
  reserve_ambulance: "Reserve the ambulance",
  validate_reservation: "Recheck hospital status",
  replan: "Re-route (original pick fell through)",
  simulate_dispatch: "Send the dispatch",
  monitor_or_finish: "Confirm complete",
  await_review: "Pause for human review",
  fail_safely: "Stop safely — no valid option",
};

export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step.replace(/_/g, " ");
}

export function hospitalDisplayName(id: string): string {
  return id.replace(/^hosp-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ambulanceDisplayName(id: string): string {
  return id.replace(/^unit-/, "Unit ");
}
