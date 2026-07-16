# Person B master prompt — hospital_ambulance_data data layer

You are implementing the remaining backend data-layer work for an existing
hackathon project, AEGIS, a protocol-gated AI emergency dispatch system.
This is NOT a from-scratch build — `services/hospital_ambulance_data`
already exists with a working Supabase-backed schema, an MCP server
exposing hospital/ambulance eligibility tools, and a
`get_nearest_ignoring_constraints` function already implemented for
baseline comparison. Before writing anything, read the existing code in
`services/hospital_ambulance_data` (`app/server.py`, `app/logic.py`,
`app/fixtures.py`, `migrations/001_schema.sql`, `tests/test_logic.py`) so
your additions match existing naming, conventions, and MCP tool patterns.
Do not restructure or rename anything that already works.

## Important context you need before starting

A hospital-diversion trigger **already exists in the system today** —
but in the wrong place. `core_orchestrator/app/main.py` has a working
`POST /admin/hospitals/{hospital_id}/status` endpoint that the dashboard
already calls, and it flips a hospital's status by reaching **directly**
into Supabase (`aegis_contracts.supabase_client.get_client()...update(...)`),
bypassing your service's MCP layer entirely. That's inconsistent with how
every other cross-service capability in this system works: a service owns
its data and is the canonical interface to it; other services reach it
through MCP (see how `core_orchestrator`'s own `/baseline` endpoint calls
`hospital_ambulance_data` via the registry + `call_tool`, not via Supabase
directly — that's the pattern to match, not the admin endpoint's).

Your job is to build the *correct* version of this capability in your
service. You will **not** rewire `core_orchestrator`'s endpoint yourself
(it's Person A's file, and touching it isn't your call to make alone) —
instead, deliverable #1 below includes a short, explicit note for Person A
describing the one-line swap they should make once your tool exists. Until
they make that swap, both paths will work correctly against the same
underlying constraints; you are not breaking anything by leaving the old
path in place temporarily.

## Why your existing work already matters most for the actual challenge brief

The hackathon brief for this challenge ("Automated Medical Emergency
Response and Ambulance Dispatch") asks for three things: patient
assessment, resource matching, and autonomous dispatch with live traffic
data, without needing a human dispatcher. Of everything in this system,
**your service's already-shipped code is the most direct implementation
of the "resource matching" requirement, full stop** —
`get_eligible_hospitals`/`get_eligible_ambulances` correctly filtering by
live status, open beds, specialty match, and distance *is* "automatically
checks which nearby hospitals have open beds," verbatim. That was true
before this prompt existed. Don't undervalue it relative to the new tasks
below just because it was built earlier — if anyone asks what in this
codebase most literally answers the brief, it's that.

Two things follow from this for how you should prioritize below:

- **Task 3 (the concurrency test) matters more than its "stretch" label
  suggests.** The brief's "without needing a human dispatcher" implicitly
  requires the system to hold up under *concurrent* calls, not just one
  at a time — a fleet that can be double-booked under real load is a
  direct failure of the autonomy claim, not just a nice-to-have
  robustness test. If you have to choose between polishing task 1/2
  further versus reaching task 3, lean toward reaching task 3.
- **Task 4 (predictive relocation) is the closest thing in your scope to
  a literal "AI agent"** in the sense the brief's language suggests —
  reasoning about fleet positioning from patterns, autonomously, outside
  the safety-critical dispatch path. It's still correctly last on the
  cut list (lowest priority, cut first if short on time), but worth
  knowing it's not just busywork if you do get to it — it's the one item
  here that would make the "agent" framing feel literal, not just
  architectural.

## Team context

Three teammates are working in parallel: Person A owns `core_orchestrator`
(the LangGraph workflow, the diversion/replan trigger endpoint, Send-API
spawning at `rank_assignments`), Person C owns `routing` and the
dashboard, Person D owns voice ingestion and the demo. Your MCP tool needs
to be usable by a demo script (Person D) and, after Person A's follow-up
swap, by the dashboard's existing diversion control — without anyone
needing to touch your code to use it.

## YOUR SCOPE

### 1. `set_hospital_status` MCP tool (primary deliverable)

Add `set_hospital_status(hospital_id: str, status: str) -> dict` to
`app/logic.py`, matching the existing style: a thin `@mcp.tool()` wrapper
in `server.py` calling a plain function in `logic.py`, same error-handling
shape as `hospital_capacity` (raise `ValueError` for an unknown
`hospital_id`; let Supabase errors propagate — nothing in this service
catches-and-fabricates a fallback response for its own writes). `status`
must be validated against the same two values the DB constraint allows
(`OPEN`, `DIVERSION`) — reject anything else with a clear error rather
than letting Postgres's `check` constraint be the only thing catching it.
Return the updated row, same shape as `hospital_capacity`'s return value.

**Verify, don't assume, that this actually invalidates the hospital for
eligibility queries.** Read `logic._fetch_hospitals()` before you start —
at the time of this prompt it does `.eq("status", "OPEN")` at the Supabase
query level, so a status flip should already correctly exclude a diverted
hospital from `get_eligible_hospitals` results with no other change
required. Confirm this is still true by writing a test that flips a
hospital to `DIVERSION` and asserts it disappears from
`get_eligible_hospitals`'s results, then flips it back and confirms it
reappears. If you find this *isn't* actually true anymore, that's a real
bug in existing code — flag it to the team before changing
`get_eligible_hospitals`'s behavior, per the constraints below.

**Cross-team note to write down and hand to Person A** (do not implement
this part yourself): once your tool exists, `core_orchestrator/app/main.py`'s
`set_hospital_status` endpoint should be changed from a direct Supabase
`.update()` call to `registry.get("hospital_ambulance_data")` +
`call_tool(service.base_url, "set_hospital_status", {...})` — the same
pattern their `/baseline` endpoint already uses one function above it in
the same file. This is a same-shape, low-risk swap, but it's their file to
change, not yours.

### 2. Seed-data verification for the diversion demo beat

The demo needs: `hosp-cardiac-center` (the cardiac case's selected
hospital) goes to `DIVERSION` mid-run, and `hosp-trauma` needs to be a
valid cardiac-capable fallback for `replan` to land on. Verify this holds
against the current seed data in `app/fixtures.py` — write (or extend an
existing) test asserting `hosp-trauma` has `"cardiac"` in its
`specialties`, `bed_count > 0`, and is within `get_eligible_hospitals`'s
default search radius of the demo patient coordinates
(`DEMO_PATIENT_LAT`/`DEMO_PATIENT_LNG` in `fixtures.py`). If any of that
isn't true, fix the seed data (and `seed.py`, which loads it) so the
replan beat is reliably demonstrable, not a coin flip. If you change
seed data, re-run `py seed.py` against Supabase and confirm with a live
query, not just by reading the fixture file.

### 3. Fleet-contention concurrency test (stretch — only after 1 and 2 are solid and tested)

`services/hospital_ambulance_data/migrations/001_schema.sql` has a
`unique (ambulance_id)` constraint on `reservations`. There is currently
no test that exercises this at the raw-Supabase level — the only existing
concurrency coverage (`core_orchestrator/tests/test_run_batch.py`) goes
through the full Python `reservation_store` wrapper, not simultaneous raw
inserts. Write a test in this service that fires several concurrent
`insert` attempts at the same `ambulance_id` directly against Supabase and
confirms exactly one succeeds and the rest fail on the unique constraint
(not that they silently overwrite or race into duplicate rows). If it
doesn't hold under real concurrent load, that's a real bug — fix the
constraint or the write path, don't just document the gap. Coordinate
with Person A before changing anything in `reservation_store.py` itself
(that file is theirs); if a fix is needed there, hand them the same kind
of explicit written note as in task 1, don't edit it yourself.

### 4. Predictive relocation (stretch, lowest priority — cut first per the team's cut list)

Only attempt this if 1–3 are done, tested, and merged. Idle-ambulance
repositioning based on historical/predicted demand would need new schema
(movement history or zone data). Do not touch the schema for this
speculatively — confirm with the team there's actually time left before
starting.

### 5. Tests

Add tests for: the status flip (both directions), its effect on
`get_eligible_hospitals`, the new MCP tool's error handling for an unknown
`hospital_id` and an invalid `status` value, and (if you reach it) the
concurrency test from task 3. Follow the existing pattern in
`tests/test_logic.py`: plain sync tests, the `requires_supabase` skip
marker, calling `logic.*` functions directly rather than going through
the MCP transport.

## CONSTRAINTS

- Do not touch `services/core_orchestrator`, `services/routing`, or
  `services/dashboard` — those are owned by teammates. Where your work
  implies a change in one of those (see task 1's cross-team note), write
  it down explicitly for the owner instead of making it yourself.
- Do not change existing MCP tool signatures (`get_eligible_hospitals`,
  `get_eligible_ambulances`, `get_hospital_capacity`,
  `get_nearest_ignoring_constraints`) unless you find and confirm an
  actual bug — flag it to the team before changing it, since Person A and
  Person C's code already depends on these.
- Run `py scripts/run_tests.py` after your changes land and confirm the
  *entire existing suite* still passes, not just your new tests.

## DELIVERABLE

The `set_hospital_status` MCP tool with verified eligibility-invalidation
behavior, the written cross-team note for Person A's endpoint swap,
verified (and fixed if necessary) seed data for the diversion beat, the
concurrency test for the reservations constraint (stretch), and test
coverage for all of the above. Update `README.md` and `services.yaml`'s
`tools:` list for `hospital_ambulance_data` to include the new tool. While
you're in `services.yaml`, note (but don't feel obligated to fix unless
it's quick) that `core_orchestrator`'s entry there is already stale — it
lists only `tools: [dispatch]` even though that service also exposes
`/dispatch/batch`, `/baseline`, and the admin status endpoint; worth
flagging to Person A alongside the task 1 note.
