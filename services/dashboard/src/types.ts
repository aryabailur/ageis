/**
 * Mirrors shared/aegis_contracts/aegis_contracts/models.py. Keep these two
 * in sync by hand for now — the contract is locked per the master prompt,
 * so it should change rarely enough that this isn't a burden.
 */

export type DispatchStatus = "IN_PROGRESS" | "AWAITING_REVIEW" | "DISPATCHED" | "COMPLETED" | "FAILED";
export type Priority = "P1" | "P2" | "P3" | "UNKNOWN";
export type TranscriptQuality = "high" | "medium" | "low";

export interface TimingEntry {
  step: string;
  start: number;
  end: number | null;
}

export interface Incident {
  raw_transcript: string;
  chief_complaint: string;
  breathing_normally: boolean | null;
  major_bleeding: boolean | null;
  conscious: boolean | null;
  location_lat: number | null;
  location_lng: number | null;
  transcript_quality: TranscriptQuality;
  extraction_data_source: string;
}

export interface TriageResult {
  priority: Priority;
  rule_ids: string[];
  requires_als: boolean;
  required_hospital_specialty: string | null;
}

export interface Ambulance {
  id: string;
  lat: number;
  lng: number;
  capability: "BLS" | "ALS";
  status: string;
}

export interface Hospital {
  id: string;
  lat: number;
  lng: number;
  bed_count: number;
  specialties: string[];
  status: string;
}

export interface RejectionReason {
  reason_code: string;
  human_text: string;
}

export interface CandidateAssignment {
  ambulance: Ambulance;
  hospital: Hospital;
  ambulance_eta_minutes: number | null;
  hospital_eta_minutes: number | null;
  score: number | null;
  rejected: boolean;
  rejection: RejectionReason | null;
  route_data_source: string;
}

export interface Reservation {
  reservation_id: string;
  ambulance_id: string;
  hospital_id: string;
  idempotency_key: string;
  confirmed: boolean;
}

export interface DispatchState {
  call_id: string;
  status: DispatchStatus;
  raw_transcript: string;
  caller_lat: number | null;
  caller_lng: number | null;
  incident: Incident | null;
  triage: TriageResult | null;
  prearrival: unknown | null;
  available_ambulances: unknown[];
  available_hospitals: unknown[];
  resource_data_source: [string, string] | null;
  candidates: CandidateAssignment[];
  selected: CandidateAssignment | null;
  reservation: Reservation | null;
  complexity_score: number | null;
  spawned_workers: number;
  replan_count: number;
  max_replans: number;
  review_reason: string | null;
  failure_reason: string | null;
  timing_log: TimingEntry[];
}
