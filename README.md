# AEGIS (codename PROHCK)

Protocol-gated autonomous emergency dispatch agent. Built per
`AEGIS_Final_Master_Prompt.docx` as a set of independently runnable
microservices that attach to each other through one plugin registry,
so new capabilities (a voice-ingest service, the CPR-coaching node, a
survival-impact-meter view, a second data provider) can be dropped in
without touching existing services.

Four non-negotiable design laws (from the master prompt) shape every
service in this repo:

1. **The LLM only listens. The protocol decides.** Triage, validation,
   scoring, and reservation are deterministic code. The LLM (or its
   keyword-matching stand-in, see below) is only used to extract stated
   facts from a transcript.
2. **Autonomous by default; human-gated only under uncertainty.**
3. **Speed is a primary metric.** Every node/external call appends a
   `{step, start, end}` entry to `timing_log`.
4. **Degrade gracefully, visibly.** Every external call has a labeled
   fallback and a short timeout — never a retry loop.

## Architecture

```
services/
  hospital_ambulance_data/   MCP microservice: ambulances + hospitals, backed by Supabase
    migrations/001_schema.sql   Run once in the Supabase SQL editor
    seed.py                     Loads demo data into the tables
  routing/                   MCP microservice: Mapbox Directions (traffic-aware) -> Haversine fallback
  core_orchestrator/         LangGraph workflow + FastAPI /dispatch endpoint; reservations in Supabase
  dashboard/                 React + TypeScript (Vite) console
  _template_new_service/     Copy this to attach a new plugin microservice
shared/
  aegis_contracts/           The locked DispatchState contract + registry + fallback/timing helpers + Supabase client factory
services.yaml                The plugin registry — the ONE file you edit to attach a service
.env.example                 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MAPBOX_API_KEY — copy to .env
docker-compose.yml
scripts/
  dev_up.py                  Run every service locally (no Docker) from services.yaml
  run_tests.py                Run every service's test suite
```

### The plugin mechanism

Every service resolves its peers through
`aegis_contracts.load_default_registry()`, which reads `services.yaml`.
Nobody hardcodes a hostname — a node asks the registry for a service by
name (or by the MCP tool it claims to expose) and gets a `base_url`.

**To attach a new microservice:**

1. Copy `services/_template_new_service/` and rename it.
2. Implement your tool(s) as `@mcp.tool()` functions.
3. Add one entry to `services.yaml` with its name, `base_url`, and the
   tools it exposes.
4. Any node anywhere in the system can now call it —
   `registry.get("your_service_name")` or `registry.resolve_tool("your_tool")`.

Per-deployment overrides (docker-compose, k8s) don't need to touch
`services.yaml`: set `AEGIS_SERVICE_<NAME_UPPER>_URL` and it wins.

### CORE-tier scope (this build)

This pass implements the CORE tier only, per the master prompt's own
build order: the locked contract, the full LangGraph workflow
(ingest → extract → triage → [review gate] → load resources → route
estimate → rank → validate → reserve → dispatch → complete, with bounded
replan and a fail-safe path), both MCP data services with fallbacks, and
a minimal dashboard.

**Not yet attached** (HIGH-VALUE tier, by design — the contract already
reserves the fields they need so attaching them later is additive, not
a breaking change):
- `dispatch_prearrival_guidance` (CPR coaching / metronome) — `prearrival`
  field is already on `DispatchState`.
- Survival Impact Meter (frontend-only, derived from `timing_log`).
- Live-mic voice ingestion (Whisper).
- Chaos/scale mode (`run_batch`).

### Real data + real routing

`hospital_ambulance_data` and `core_orchestrator`'s reservations now read
and write a real Supabase Postgres database instead of in-memory Python
data — see `services/hospital_ambulance_data/migrations/001_schema.sql`
for the schema and `services/hospital_ambulance_data/seed.py` for demo
data. `routing` calls the Mapbox Directions API (`driving-traffic`
profile) for real traffic-aware ETAs, falling back to the labeled
Haversine estimate if `MAPBOX_API_KEY` is unset or the call fails —
exactly the same fallback ladder shape as before, just with a real rung
on top now instead of a stub.

**One-time setup, before running anything:**

1. Copy `.env.example` to `.env` at the repo root and fill in
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MAPBOX_API_KEY`.
2. Run `services/hospital_ambulance_data/migrations/001_schema.sql` in
   your Supabase project's SQL editor.
3. `cd services/hospital_ambulance_data && py seed.py` to load demo data.

Tests that need Supabase (`hospital_ambulance_data`'s eligibility tests,
`core_orchestrator`'s clean-cardiac-path test) skip cleanly with a reason
if `.env` isn't configured, rather than failing the suite.

## Running it

**Without Docker** (what was used to verify this build):

```
py -m pip install -e shared/aegis_contracts
py -m pip install -r services/hospital_ambulance_data/requirements.txt
py -m pip install -r services/routing/requirements.txt
py -m pip install -r services/core_orchestrator/requirements.txt
cd services/dashboard && npm install && cd ../..

py scripts/dev_up.py
```

Then open the dashboard at http://localhost:5173, or call the
orchestrator directly:

```
curl -X POST http://localhost:8000/dispatch \
  -H "Content-Type: application/json" \
  -d '{"call_id":"call-1","raw_transcript":"chest pain, left arm numb, not breathing right","caller_lat":42.3601,"caller_lng":-71.0589}'
```

**With Docker:** `docker compose up --build`.

The dashboard is a plain Vite/React SPA that calls `core_orchestrator`
directly from the browser (`services/dashboard/src/api.ts`), so it needs
one thing the rest of the system resolves server-side through
`services.yaml`: `VITE_ORCHESTRATOR_URL` (copy `.env.example` to `.env` to
change it from the `http://localhost:8000` default). `core_orchestrator`
allows the dashboard's dev origin via CORS in `services/core_orchestrator/app/main.py`.

## Testing

```
py scripts/run_tests.py
```

`services/core_orchestrator/tests/test_clean_cardiac_path.py` is the
scenario the master prompt calls out to run first during integration: it
spins up both MCP microservices as real subprocesses and drives the full
graph, asserting the clean cardiac call reaches `COMPLETED` with zero
human review (rejecting the nearer BLS unit and the nearer non-cardiac
hospital along the way), and that a garbled transcript correctly
escalates to `AWAITING_REVIEW`.
