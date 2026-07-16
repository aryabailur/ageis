import logging

from fastapi import FastAPI, HTTPException

from app.agent import (
    AgentUnavailable,
    build_raw_transcript,
    call_dispatch,
    run_agent_loop,
)
from app.models import IntakeRequest, IntakeResult

logger = logging.getLogger("call_intake_agent")

app = FastAPI(title="call_intake_agent")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "call_intake_agent"}


@app.post("/intake", response_model=IntakeResult)
async def intake(request: IntakeRequest) -> IntakeResult:
    questions: list[str] = []
    answers: list[str] = []
    facts = None
    path_used = "AGENT_LOOP"

    try:
        facts, questions, answers = await run_agent_loop(request.initial_statement)
        raw_transcript = build_raw_transcript(
            request.initial_statement, questions, answers
        )
    except AgentUnavailable as exc:
        logger.warning(
            "call_id=%s agent loop unavailable (%s) — using deterministic fallback",
            request.call_id,
            exc,
        )
        path_used = "DETERMINISTIC_FALLBACK"
        raw_transcript = request.initial_statement

    try:
        dispatch_result = await call_dispatch(
            call_id=request.call_id,
            raw_transcript=raw_transcript,
            caller_lat=request.caller_lat,
            caller_lng=request.caller_lng,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("call_id=%s dispatch call failed: %s", request.call_id, exc)
        raise HTTPException(
            status_code=502, detail=f"core_orchestrator /dispatch call failed: {exc}"
        ) from exc

    return IntakeResult(
        call_id=request.call_id,
        path_used=path_used,
        follow_up_questions=questions,
        follow_up_answers=answers,
        extracted_facts=facts,
        raw_transcript=raw_transcript,
        dispatch_result=dispatch_result,
    )
