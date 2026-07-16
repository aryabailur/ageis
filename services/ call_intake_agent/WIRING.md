# Wiring this into the AEGIS repo

I don't have your actual `services.yaml`, root `README.md`, or
`core_orchestrator/app/extractors.py` in front of me, so I couldn't edit
them directly or match your exact indentation/port scheme. Everything
below is copy-paste — just check the two spots flagged ⚠️ against your
real files before running.

## 1. Add to `services.yaml`

Match this to `core_orchestrator`'s existing entry shape (`kind: http`).
⚠️ Port `8004` is a guess — change it to whatever the next free port in
your scheme actually is (check what core_orchestrator/hospital_ambulance_data/
routing/dashboard already use).

```yaml
call_intake_agent:
  kind: http
  path: services/call_intake_agent
  port: 8004
  health_check: /health
  env:
    - GROQ_API_KEY
    - GROQ_MODEL
    - CORE_ORCHESTRATOR_URL
    - INTAKE_ANSWER_MODE
```

## 2. Add to root `.env` / `.env.example`

```
GROQ_MODEL=llama-3.3-70b-versatile
CORE_ORCHESTRATOR_URL=http://core_orchestrator:8000
INTAKE_ANSWER_MODE=scripted
```

`GROQ_API_KEY` should already exist per the master prompt — this service
reuses it, doesn't request a new one.

`INTAKE_ANSWER_MODE=scripted` is the safe rehearsal default (canned
answers, never blocks on stdin). Set it to `live` only when you're
literally standing at the keyboard playing the caller during the demo.

## 3. Add to `docker-compose.yml`

Mirror whatever block `core_orchestrator` has, e.g.:

```yaml
call_intake_agent:
  build: ./services/call_intake_agent
  ports:
    - "8004:8004"
  env_file: .env
  depends_on:
    - core_orchestrator
```

## 4. `README.md` architecture section — suggested line to add

```
- **call_intake_agent** (`services/call_intake_agent`) — multi-turn
  intake agent. Bounded tool-calling loop (Groq) asks up to 3 follow-up
  questions to resolve ambiguous 911 calls before handing a structured
  transcript to `core_orchestrator`'s `/dispatch`. Falls back to a
  direct one-shot `/dispatch` call if Groq is unavailable. Never makes
  a triage or dispatch decision itself.
```

## 5. Double-check against the real `extractors.py`

⚠️ I built `SYSTEM_PROMPT` and the `ExtractedFacts` model in
`app/models.py` from the field names given in the master prompt
(`chief_complaint`, `breathing_normally`, `major_bleeding`, `conscious`,
`transcript_quality`, values `CARDIAC`/`BLEEDING`/`CHOKING`/`UNKNOWN`).
Open `core_orchestrator/app/extractors.py` and diff its
`EXTRACTION_SYSTEM_PROMPT` / Pydantic model against
`app/models.py::ExtractedFacts` — if Person A has since added or renamed
a field (e.g. an extra severity-adjacent flag), mirror it here too so
both extraction paths stay interchangeable.

## 6. Confirm the `/dispatch` request shape

⚠️ I assumed `POST /dispatch` on `core_orchestrator` takes exactly
`{call_id, raw_transcript, caller_lat, caller_lng}` per the master
prompt. If `DispatchRequest` in `core_orchestrator/app/main.py` has any
additional required fields, add them to `call_dispatch()` in
`app/agent.py` and to `IntakeRequest` in `app/models.py`.

## 7. Run the full suite after wiring

```
python scripts/run_tests.py
```
to confirm nothing existing broke (this service doesn't touch anyone
else's files, so it shouldn't, but the master prompt asks for this
regardless).

## 8. Local smoke test (no Docker needed)

```bash
cd services/call_intake_agent
pip install -r requirements-dev.txt
PYTHONPATH=. pytest tests/ -v
PYTHONPATH=. uvicorn app.server:app --reload --port 8004
```

Then, with core_orchestrator running separately on its usual port:

```bash
curl -X POST http://localhost:8004/intake \
  -H "Content-Type: application/json" \
  -d '{"call_id":"demo-1","initial_statement":"Someone collapsed and is not breathing right","caller_lat":19.076,"caller_lng":72.8777}'
```
