# AEGIS — 90-second demo arc

Run this against the real running stack (`docker-compose up --build`),
not a mockup. Timings are targets, not hard cuts — rehearse until they're
close.

| Time | Beat | What's on screen / said | Owner |
|---|---|---|---|
| 0:00–0:08 | **Hook** | "Every minute without CPR after cardiac arrest costs about 10% survival. Most 911 systems can't act until a human picks a hospital." | D (narrating) |
| 0:08–0:25 | **Intake agent asks a real follow-up** | Call `POST /intake` live with a deliberately ambiguous statement ("someone collapsed, not sure what's going on"). Agent calls `ask_follow_up` on stage — audience sees the actual question, answer it live (`INTAKE_ANSWER_MODE=live`). | D |
| 0:25–0:35 | **CPR panel fires instantly** | The moment triage completes, CPR coaching panel appears (pulsing dot + bpm) — before the map/route resolves. | C's component, D calls it out |
| 0:35–0:50 | **AEGIS rejects the wrong choice** | Show a candidate ambulance/hospital get rejected by the protocol table with a visible reason (e.g. wrong capability, over capacity). | A/C |
| 0:50–1:05 | **Diversion → replan** | Toggle `hosp-cardiac-center` to DIVERSION via the dashboard control. Replan fires, `hosp-trauma` gets selected instead — narrate that this happened without any human intervention. | B/C, D narrates |
| 1:05–1:15 | **Dispatch locks in** | Final unit + hospital shown, reservation confirmed. | A/C |
| 1:15–1:25 | **Survival-gap callout** | Survival Impact Meter: AEGIS's actual dispatch time vs. the naive baseline from `get_nearest_ignoring_constraints`. State the delta out loud. | C, D narrates |
| 1:25–1:30 | **Close** | "The LLM only listens. The protocol decides. That's why this is safe enough to actually dispatch." | D |

## Uncertainty / review-gate beat (if time allows, or as a Q&A follow-up)

Feed the intake agent a statement that stays ambiguous even after 3
follow-ups (or just let it exhaust the bound). Show `chief_complaint:
UNKNOWN` flowing into `core_orchestrator` and landing in
`AWAITING_REVIEW` — proof the safety net catches what the agent
couldn't resolve, rather than the agent silently guessing.

## Rehearsal checklist

- [ ] Run with `INTAKE_ANSWER_MODE=scripted` at least once end-to-end with
      zero human intervention, to confirm the fallback-free happy path
      never hangs.
- [ ] Run once with `INTAKE_ANSWER_MODE=live` and actually type an answer
      on stage, timed.
- [ ] Kill `GROQ_API_KEY` (unset it) and confirm `/intake` still reaches
      `/dispatch` via `DETERMINISTIC_FALLBACK` — this is the "network
      dies on stage" insurance policy.
- [ ] Confirm the diversion toggle actually flips `hosp-cardiac-center`
      before the demo, on the real seeded data, not stale local state.
- [ ] Time each beat with a stopwatch at least twice; note where it runs
      long.

## Backup video checklist (Task 5)

Pre-record and save locally (not just on stage laptop) covering at
minimum:
- [ ] The intake agent asking a follow-up question and getting an answer.
- [ ] The CPR coaching panel appearing.
- [ ] The Survival Impact Meter showing the gap vs. baseline.

## Chaos-mode clip (Task 6, stretch — only if Person A's `run_batch` lands)

Record 8–12 concurrent incidents contending for the same fleet, with the
Supabase unique constraint visibly preventing any ambulance from being
double-booked. Lowest priority — cut first if short on time.

## Pitch one-liner (Task 4 packaging)

> "AEGIS is the dispatcher, not the chatbot: the only place an LLM
> touches this system is listening to the caller. Every decision that
> actually moves an ambulance is a deterministic, auditable protocol
> rule — including the one exception, our intake agent, which only ever
> asks clarifying questions and never decides anything."

Problem-statement coverage map and full slide/one-pager content: fill in
once A/B/C's pieces are demo-stable, so the "why this beats a chatbot"
talking points can reference the actual working diversion/replan and
survival-meter beats rather than a planned version of them.
