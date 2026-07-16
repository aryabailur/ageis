import { useEffect, useState } from "react";
import { useDispatchStore } from "./store/dispatchStore";
import { useVoiceStore } from "./store/voiceStore";
import type { Hospital, Priority } from "./types";
import { CommandHeader } from "./components/CommandHeader";
import { CityMap } from "./components/CityMap";
import { DecisionTimeline } from "./components/DecisionTimeline";
import { AgentReasoningPanel } from "./components/AgentReasoningPanel";
import { ReviewBanner } from "./components/ReviewBanner";
import { IncidentIntakePanel } from "./components/IncidentIntakePanel";
import { HospitalCapacityPanel } from "./components/HospitalCapacityPanel";
import { DispatchForm } from "./components/DispatchForm";
import { EmergencySummaryCard } from "./components/EmergencySummaryCard";
import { ConversationTranscriptCard } from "./components/ConversationTranscriptCard";
import { StatusBadge } from "./components/StatusBadge";
import { TriageCard } from "./components/TriageCard";
import { CoachingPanel } from "./components/CoachingPanel";
import { CandidateList } from "./components/CandidateList";
import { ReservationCard } from "./components/ReservationCard";
import { TimingBreakdown } from "./components/TimingBreakdown";
import { ComplexityPanel } from "./components/ComplexityPanel";
import { SurvivalMeter } from "./components/SurvivalMeter";
import { BaselineComparison } from "./components/BaselineComparison";

export default function App() {
  const {
    current,
    timeline,
    baseline,
    fleet,
    isRunning,
    error,
    callsHandled,
    callsAutonomous,
    startDispatch,
    applyReview,
    loadFleet,
  } = useDispatchStore();

  useEffect(() => {
    loadFleet();
  }, [loadFleet]);

  // Fleet capacity/map data should track live edits (diversion flips) and
  // reflect a just-completed reservation without waiting for a manual
  // refresh -- re-pull whenever a call reaches a state where the fleet
  // could plausibly have changed.
  useEffect(() => {
    if (current?.status === "DISPATCHED" || current?.status === "COMPLETED") {
      loadFleet();
    }
  }, [current?.status, loadFleet]);

  // Auto-dispatch: the ONE place in this app a dispatch starts without a
  // human clicking a button. Fires only when the mobile AI conversation
  // (/call) has gathered enough patient info on its own and broadcasts
  // `ready_for_dispatch` -- reuses the SAME startDispatch action and
  // /dispatch/stream endpoint DispatchForm/handleUseVoiceTranscript use,
  // so there is exactly one dispatch code path in this project.
  const dispatchReadyPayload = useVoiceStore((s) => s.dispatchReadyPayload);
  const clearDispatchReadyPayload = useVoiceStore((s) => s.clearDispatchReadyPayload);
  const [autoDispatchedCallId, setAutoDispatchedCallId] = useState<string | null>(null);
  useEffect(() => {
    if (!dispatchReadyPayload) return;
    const payload = dispatchReadyPayload;
    clearDispatchReadyPayload();
    setAutoDispatchedCallId(payload.call_id);
    startDispatch({
      call_id: payload.call_id,
      raw_transcript: payload.raw_transcript,
      caller_lat: payload.caller_lat,
      caller_lng: payload.caller_lng,
    });
  }, [dispatchReadyPayload, clearDispatchReadyPayload, startDispatch]);

  function handleHospitalStatusChanged(updated: Hospital) {
    const store = useDispatchStore.getState();
    if (store.fleet) {
      useDispatchStore.setState({
        fleet: {
          ...store.fleet,
          hospitals: store.fleet.hospitals.map((h) => (h.id === updated.id ? updated : h)),
        },
      });
    }
  }

  function handleOverrideTriage(priority: Priority, requiresAls: boolean, specialty: string | null) {
    applyReview({
      decision: "OVERRIDE",
      triage_override: {
        priority,
        rule_ids: ["HUMAN_OVERRIDE"],
        requires_als: requiresAls,
        required_hospital_specialty: specialty,
      },
    });
  }

  function handleOverrideCandidate(candidateKey: string) {
    if (!current) return;
    const [ambulanceId, hospitalId] = candidateKey.split("|");
    const candidate = current.candidates.find((c) => c.ambulance.id === ambulanceId && c.hospital.id === hospitalId);
    if (!candidate) return;
    applyReview({ decision: "OVERRIDE", selected_override: { ...candidate, rejected: false, rejection: null } });
  }

  // Voice transcript -> the SAME DispatchRequest shape DispatchForm already
  // produces, submitted through the SAME startDispatch action -- voice is
  // only a new way to fill in raw_transcript, never a new dispatch path.
  // Only fires on explicit user click, never automatically when a
  // transcript arrives.
  function handleUseVoiceTranscript(transcript: string) {
    startDispatch({
      call_id: `call-${Date.now().toString(36)}`,
      raw_transcript: transcript,
      caller_lat: 42.3601,
      caller_lng: -71.0589,
    });
  }

  const isAwaitingReview = current?.status === "AWAITING_REVIEW";

  return (
    <div className="app">
      <CommandHeader fleet={fleet} current={current} callsHandled={callsHandled} callsAutonomous={callsAutonomous} />

      <div className="app-body">
        {/* --- LEFT: Emergency Summary --- */}
        <div className="app-left">
          <EmergencySummaryCard onUseTranscript={handleUseVoiceTranscript} />
          <DispatchForm onSubmit={startDispatch} isLoading={isRunning} />
        </div>

        {/* --- CENTER: Live map + decision timeline + call detail --- */}
        <div className="app-center">
          {isAwaitingReview && current && (
            <ReviewBanner
              state={current}
              onApprove={() => applyReview({ decision: "APPROVE" })}
              onOverrideTriage={handleOverrideTriage}
              onOverrideCandidate={handleOverrideCandidate}
              isSubmitting={isRunning}
            />
          )}

          {autoDispatchedCallId && (
            <div className="card" style={{ borderColor: "var(--success-border)", background: "var(--success-bg)" }}>
              <strong>Auto-dispatch started</strong> — the AI phone conversation ({autoDispatchedCallId}) gathered
              enough patient information on its own and submitted this call for dispatch automatically. No human
              clicked "start."
            </div>
          )}

          {error && <div className="card card-error">{error}</div>}

          <div className="map-outer">
            <CityMap fleet={fleet} current={current} />
          </div>

          <div className="card">
            <div className="panel-header">
              <h2>Dispatch decision</h2>
              {current && <StatusBadge status={current.status} />}
            </div>
            <DecisionTimeline timeline={timeline} current={current} />
            {current && current.replan_count > 0 && (
              <span
                className="pill pill-warning"
                title="The originally-picked ambulance or hospital stopped being valid (booked elsewhere, went on diversion, etc) after AEGIS chose it — it automatically found the next-best option instead of failing."
              >
                self-corrected {current.replan_count}× — re-routed automatically
              </span>
            )}
            {current?.failure_reason && (
              <span className="pill pill-error">Couldn't complete: {current.failure_reason}</span>
            )}
          </div>

          {current?.incident && (
            <SurvivalMeter timingLog={current.timing_log} chiefComplaint={current.incident.chief_complaint} />
          )}
        </div>

        {/* --- RIGHT: AI Brain + conversation --- */}
        <div className="app-right">
          <AgentReasoningPanel timeline={timeline} current={current} />
          <ConversationTranscriptCard />
        </div>

        {/* --- BOTTOM: supporting detail (scrollable strip) --- */}
        <div className="app-bottom">
          {current && (
            <>
              <div className="grid-2">
                <IncidentIntakePanel state={current} />
                <HospitalCapacityPanel
                  fleet={fleet}
                  selectedHospitalId={current.selected?.hospital.id ?? null}
                  onStatusChanged={handleHospitalStatusChanged}
                />
              </div>

              {current.prearrival && <CoachingPanel prearrival={current.prearrival} />}
              {current.triage && <TriageCard triage={current.triage} />}

              {baseline && current.selected && current.triage && (
                <BaselineComparison baseline={baseline} selected={current.selected} triage={current.triage} />
              )}

              <CandidateList candidates={current.candidates} selected={current.selected} />

              <div className="grid-2">
                <ReservationCard reservation={current.reservation} />
                <ComplexityPanel
                  complexityScore={current.complexity_score}
                  spawnedWorkers={current.spawned_workers}
                  reverifiedCandidates={current.reverified_candidates}
                />
              </div>

              <TimingBreakdown timingLog={current.timing_log} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
