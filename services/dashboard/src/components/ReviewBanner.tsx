import { useState } from "react";
import type { DispatchState, Priority } from "../types";
import { ambulanceDisplayName, hospitalDisplayName, rejectionLabel, specialtyLabel } from "../glossary";

const PRIORITIES: Priority[] = ["P1", "P2", "P3"];
const SPECIALTIES = ["cardiac", "trauma", "stroke", "general"];

interface Props {
  state: DispatchState;
  onApprove: () => void;
  onOverrideTriage: (priority: Priority, requiresAls: boolean, specialty: string | null) => void;
  onOverrideCandidate: (candidateKey: string) => void;
  isSubmitting: boolean;
}

/**
 * Renders only when state.status === AWAITING_REVIEW. Two structurally
 * distinct gates produce that status (see gates.mark_awaiting_review):
 * intake (triage priority UNKNOWN / low-confidence transcript) needs a
 * corrected TriageResult; assignment (no candidate satisfied hard
 * constraints) needs a human-forced candidate. Which form renders is
 * decided by the real review_reason text the backend sent, not guessed.
 */
export function ReviewBanner({ state, onApprove, onOverrideTriage, onOverrideCandidate, isSubmitting }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [priority, setPriority] = useState<Priority>("P2");
  const [requiresAls, setRequiresAls] = useState(true);
  const [specialty, setSpecialty] = useState<string>("cardiac");
  const [candidateKey, setCandidateKey] = useState<string>("");

  const isAssignmentGate = state.selected === null && state.triage !== null && state.triage.priority !== "UNKNOWN";
  const viableCandidates = state.candidates.filter((c) => !c.rejected);

  return (
    <div className="review-banner">
      <div className="review-banner-main">
        <div className="review-banner-text">
          <span className="review-banner-title">⚠ AEGIS isn't confident — needs a human · call {state.call_id}</span>
          <span className="review-banner-reason">{state.review_reason}</span>
        </div>
        <div className="review-banner-actions">
          <button type="button" className="btn-approve" disabled={isSubmitting} onClick={onApprove} title="Accept AEGIS's current best guess and continue automatically">
            Approve
          </button>
          <button type="button" className="btn-override" disabled={isSubmitting} onClick={() => setExpanded((e) => !e)} title="Supply the correct answer yourself and continue">
            Override
          </button>
        </div>
      </div>

      {expanded && (
        <div className="review-override-form">
          {isAssignmentGate ? (
            <>
              <p className="muted">
                Every option was ruled out for a hard reason (wrong crew type, hospital full, etc). Pick one
                anyway if you know it's actually OK:
              </p>
              <div className="review-override-row">
                <select value={candidateKey} onChange={(e) => setCandidateKey(e.target.value)}>
                  <option value="">Choose an ambulance + hospital…</option>
                  {state.candidates.map((c) => {
                    const key = `${c.ambulance.id}|${c.hospital.id}`;
                    return (
                      <option key={key} value={key}>
                        {ambulanceDisplayName(c.ambulance.id)} → {hospitalDisplayName(c.hospital.id)}
                        {c.rejection ? ` — ${rejectionLabel(c.rejection.reason_code, c.rejection.human_text)}` : ""}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  className="btn-override-submit"
                  disabled={!candidateKey || isSubmitting}
                  onClick={() => onOverrideCandidate(candidateKey)}
                >
                  Confirm override
                </button>
              </div>
              {viableCandidates.length > 0 && (
                <p className="muted review-override-hint">
                  {viableCandidates.length} option{viableCandidates.length === 1 ? "" : "s"} actually passed every check —
                  check "Options considered" below before forcing a ruled-out one.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="muted">AEGIS couldn't classify this call from the transcript. Tell it what you heard:</p>
              <div className="review-override-row">
                <label>
                  Severity
                  <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Hospital needs
                  <select value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
                    {SPECIALTIES.map((s) => (
                      <option key={s} value={s}>
                        {specialtyLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="review-override-checkbox">
                  <input type="checkbox" checked={requiresAls} onChange={(e) => setRequiresAls(e.target.checked)} />
                  Needs a paramedic crew
                </label>
                <button
                  type="button"
                  className="btn-override-submit"
                  disabled={isSubmitting}
                  onClick={() => onOverrideTriage(priority, requiresAls, specialty)}
                >
                  Confirm override
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
