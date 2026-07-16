# Person D master prompt — call intake agent, voice, demo, pitch

You are building the one genuinely agentic piece of AEGIS, plus the demo
materials that show it off. Everything else in this system is
deliberately *not* agentic — the whole safety pitch is "the LLM only
listens, the protocol decides" (see `AEGIS_Final_Master_Prompt.docx`,
Part 0). Your piece is the exception, and it's an exception *by design*:
a real 911 call is a conversation, not a one-shot transcript, and nothing
in the system today has a multi-turn agent that can ask a caller a
follow-up question. You're building that, as a new, separate, fifth
microservice — not by modifying anyone else's code.

## Why this exists and why it's yours

The actual hackathon brief asks for "an independent AI agent" that does
patient assessment, resource matching, and autonomous dispatch. The
system already does all three — but the "assessment" step today is one
LLM call with no follow-up
(`core_orchestrator/app/extractors.py::llm_extract_async`), not something
that reads as an agent doing assessment. Read that file before you start;
your service produces the *same* structured output shape, it just gets
there by asking questions first when the input is ambiguous.

This was scoped as a brand-new microservice specifically so it doesn't
collide with anyone else's work: Person A owns `core_orchestrator`
(including the one-shot extractor — you are not changing it, both paths
coexist), Person B owns `hospital_ambulance_data`, Person C owns
`routing` and the dashboard. None of their files change for you to do
this.

## Read before writing anything

- `services/_template_new_service/` — the scaffold every new service in
  this repo starts from (`Dockerfile`, `requirements.txt`, `app/server.py`,
  `tests/`). Copy it, don't start from scratch.
- `services/core_orchestrator/app/main.py` — specifically the
  `DispatchRequest` model and the `POST /dispatch` handler. This is the
  exact shape your service calls into once it has gathered facts:
  `{call_id, raw_transcript, caller_lat, caller_lng}`. It's a plain
  server-to-server HTTP call — no CORS concerns (CORS is browser-only;
  you're not calling from a browser), and you do not need Person A to
  change anything there.
- `services/core_orchestrator/app/extractors.py` — see
  `EXTRACTION_SYSTEM_PROMPT` and `llm_extract_async`. Your agent's
  eventual output needs to be compatible with what `apply_triage_rules`
  consumes (`chief_complaint`, `breathing_normally`, `major_bleeding`,
  `conscious`, `transcript_quality`) — reuse the same vocabulary
  (`CARDIAC`/`BLEEDING`/`CHOKING`/`UNKNOWN`), don't invent a new one.
- `.env.example` at the repo root — `GROQ_API_KEY` is already configured
  and working elsewhere in this system; reuse it rather than requesting a
  different provider unless you have a specific reason to.

## YOUR SCOPE

### 1. `call_intake_agent` microservice (primary deliverable)

New service at `services/call_intake_agent/`, following the existing
FastAPI-service pattern (`core_orchestrator/app/main.py`, not the
MCP-server pattern — nothing else needs to call *into* this service via
MCP; it only calls *out* to `core_orchestrator`).

**The agent loop.** A tool-calling loop against Groq (same model
tier/pattern as `extractors.py`) with exactly two tools available to it:

- `ask_follow_up(question: str)` — asks the caller a clarifying question.
  For the demo, "the caller" is either a pre-scripted set of answers
  keyed by expected question topics, or a human typing a reply live
  during the demo (your call which is more reliable to demo with — build
  whichever you're confident won't break on stage).
- `submit_facts(chief_complaint, breathing_normally, major_bleeding,
  conscious, transcript_quality)` — ends the loop and hands off
  structured facts, using the exact same vocabulary as
  `extractors.py`'s system prompt.

**Hard bound: max 3 follow-up questions**, then it must call
`submit_facts` with its best available answer regardless of remaining
ambiguity — never let this loop indefinitely. This mirrors Design Law 4's
"never a retry loop" principle applied to conversation turns, not
external calls: bounded, then move on. Note the asymmetry with the rest
of this system deliberately: everywhere else, "give up and hand to a
human" is the safe default (`AWAITING_REVIEW`) — here, "give up and
submit your best-effort facts" is correct instead, because
`core_orchestrator`'s own review gate is what safely catches a genuinely
unresolved case downstream (`chief_complaint == "UNKNOWN"` still routes
to `await_review` there). Don't duplicate that safety net in your
service — let the existing one catch it.

**Critical boundary — do not blur this:** your agent extracts and
clarifies *stated facts only*, exactly like the one-shot extractor it
sits beside. It must never decide severity, priority, or which unit/hospital
to use — that stays entirely downstream, in `core_orchestrator`'s
deterministic `apply_triage_rules`/`rank_assignments`. If you find
yourself writing logic like "if breathing is false, treat as urgent," stop
— that's triage, not extraction, and it belongs to Person A's file, not
yours.

**Wiring:** once `submit_facts` is called, build `raw_transcript` from
the full conversation (initial statement + every Q&A pair, concatenated
in order — so `core_orchestrator`'s own extractor, if it ever re-runs
on the same text, sees the full context), then `POST` to
`core_orchestrator`'s `/dispatch` with that transcript plus caller
coordinates. Return the full dispatch result to your caller (the demo
script or a future voice frontend).

Expose this behind your own endpoint, e.g. `POST /intake` accepting
`{call_id, initial_statement, caller_lat, caller_lng}`, running the loop,
then returning what `/dispatch` returned. Add the standard `/health`
route every other service has.

### 2. Deterministic fallback for the agent loop itself

Same Design Law 4 shape as everywhere else in this system: if Groq is
unreachable, times out, or the loop otherwise fails, fall back to calling
`core_orchestrator`'s existing one-shot path directly (just forward
`initial_statement` as `raw_transcript` to `/dispatch`, skip the
follow-up questions) rather than erroring out. Label which path was used
in your response so it's visible during the demo which mode actually ran.

### 3. Voice ingestion (stretch — attempt only after 1 and 2 are solid)

Whisper-based audio-to-text ahead of the agent loop, so `initial_statement`
comes from real audio instead of typed text. Keep the deterministic
typed-transcript path working as the fallback if Whisper isn't configured
or fails — same fallback shape as everything else, not a special case.

### 4. Demo script and pitch materials

Write the actual 90-second demo arc referenced in the master prompt: open
with the survival-decay stat, show the intake agent asking a real
follow-up question live, show the CPR panel and survival meter appearing,
show AEGIS rejecting the wrong ambulance/hospital with reasons, show the
diversion → replan beat (coordinate with whoever's running Person A/B/C's
demo controls by then), and close on the locked dispatch time vs the
naive baseline. Rehearse it against the actual running stack, not a
description of the stack.

### 5. Backup video

Pre-recorded run covering, at minimum, the intake agent's follow-up
question and the CPR/survival-meter moment — the two beats that matter
most if anything breaks live.

### 6. Chaos-mode clip (stretch, only if Person A's `run_batch` is demo-ready)

Short recording of several concurrent incidents contending for the
fleet, reservation constraints preventing double-dispatch. Lowest
priority in your scope — cut first if short on time.

## Tests

- Deterministic test of the turn-bound: force the agent to never resolve
  ambiguity (mock Groq to keep asking) and assert it still calls
  `submit_facts` by turn 3, not later.
- A live test (skip if `GROQ_API_KEY` unset, same pattern as elsewhere in
  this repo) asserting: an ambiguous initial statement causes at least
  one `ask_follow_up` call before `submit_facts`; a clear, unambiguous
  statement is allowed to submit immediately without asking anything
  (don't penalize efficiency).
- A test that the fallback path (task 2) actually reaches
  `core_orchestrator`'s `/dispatch` and returns a valid result when Groq
  is unavailable (mock the failure, don't require actually taking Groq
  down).

## CONSTRAINTS

- Do not touch `services/core_orchestrator`, `services/hospital_ambulance_data`,
  `services/routing`, or `services/dashboard`. Your service only ever
  calls `core_orchestrator`'s existing public `/dispatch` endpoint over
  plain HTTP — nothing there needs to change for you to do this.
- Do not have your agent make any triage, severity, or dispatch decision.
  If you're unsure whether something you're building crosses that line,
  it probably does — ask before shipping it.
- Add your service to `services.yaml` (`kind: http`, matching
  `core_orchestrator`'s entry shape) so it's attached the same way every
  other service in this system is — no special-casing.
- Run `py scripts/run_tests.py` after your changes land and confirm the
  *entire existing suite* still passes.

## DELIVERABLE

`services/call_intake_agent/` — a working multi-turn intake agent with a
bounded question loop, a deterministic fallback, tests for both, wired
into `services.yaml`; the demo script; the backup video; voice ingestion
and the chaos-mode clip if time allows. Update `README.md`'s architecture
section to list the new service.
