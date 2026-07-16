/**
 * Modeled estimate, per published OHCA survival decay: S(t) = S0 x (1-r)^t
 * with r = 0.10/min for cardiac arrest (headline figure; literature range
 * ~5-12%/min) and an illustrative S0 baseline. Frontend-derived view only,
 * computed from timing data -- deliberately NOT part of DispatchState, so
 * no model math ever lives in the protocol. Shared by SurvivalMeter (final,
 * post-hoc comparison) and IncidentIntakePanel's live in-flight clock.
 */

export const DECAY_PER_MINUTE = 0.1;
export const S0 = 0.9; // illustrative survival baseline at t=0
export const NAIVE_DISPATCH_SECONDS = 90; // modeled manual nearest-to-nearest dispatch time

export function survivalAt(seconds: number): number {
  return S0 * Math.pow(1 - DECAY_PER_MINUTE, seconds / 60);
}
