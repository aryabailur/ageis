"""
call_intake_agent's agent loop.

Boundary this file must never cross (see Person D master prompt):
this agent extracts and clarifies STATED FACTS ONLY. It must never decide
severity, priority, or which unit/hospital to use. All triage logic lives
downstream in core_orchestrator's apply_triage_rules / rank_assignments.
If you're adding an `if breathing_normally is False: ...` branch here,
stop — that doesn't belong in this file.

Two execution paths, always labeled in the result (Design Law 4 shape):
  - AGENT_LOOP: Groq-backed multi-turn tool-calling loop, bounded to
    at most 3 ask_follow_up calls before it must submit_facts.
  - DETERMINISTIC_FALLBACK: used whenever Groq is unreachable, errors,
    times out, or returns something we can't parse. Forwards
    initial_statement straight through as raw_transcript, same as
    core_orchestrator's own one-shot extractor path would receive.
"""

import asyncio
import json
import os
from typing import Awaitable, Callable, Optional

import httpx

from app.models import ExtractedFacts

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
CORE_ORCHESTRATOR_URL = os.environ.get(
    "CORE_ORCHESTRATOR_URL", "http://core_orchestrator:8000"
)
MAX_FOLLOW_UPS = 3
GROQ_TIMEOUT_SECONDS = float(os.environ.get("GROQ_TIMEOUT_SECONDS", "8"))

# Same vocabulary as core_orchestrator/app/extractors.py's
# EXTRACTION_SYSTEM_PROMPT — do not diverge from this.
SYSTEM_PROMPT = """You are a 911 call intake assistant. Your ONLY job is to
extract stated facts from what the caller tells you. You do not diagnose,
prioritize, or decide what help is needed — a separate protocol system
does that.

You have two tools:
- ask_follow_up(question): ask the caller ONE clarifying question, only if
  a fact needed below is genuinely ambiguous or missing from what they've
  said so far. You may call this at most 3 times total in a conversation.
- submit_facts(...): end the conversation and report the facts you have,
  even if some remain unknown. You MUST call this by your 3rd follow-up
  at the latest, using your best available reading of the facts.

Facts to extract, using EXACTLY these values:
- chief_complaint: one of CARDIAC, BLEEDING, CHOKING, UNKNOWN
- breathing_normally: true/false/null if truly unknown
- major_bleeding: true/false/null if truly unknown
- conscious: true/false/null if truly unknown
- transcript_quality: one of CLEAR, PARTIAL, POOR

Never infer severity or urgency. Never recommend a unit or hospital.
Only ask a follow-up if it would materially change one of the fields
above — do not ask questions out of general caution."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "ask_follow_up",
            "description": "Ask the caller one clarifying question about a stated fact.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                },
                "required": ["question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "submit_facts",
            "description": "End the call intake and report extracted facts.",
            "parameters": {
                "type": "object",
                "properties": {
                    "chief_complaint": {
                        "type": "string",
                        "enum": ["CARDIAC", "BLEEDING", "CHOKING", "UNKNOWN"],
                    },
                    "breathing_normally": {"type": ["boolean", "null"]},
                    "major_bleeding": {"type": ["boolean", "null"]},
                    "conscious": {"type": ["boolean", "null"]},
                    "transcript_quality": {
                        "type": "string",
                        "enum": ["CLEAR", "PARTIAL", "POOR"],
                    },
                },
                "required": [
                    "chief_complaint",
                    "breathing_normally",
                    "major_bleeding",
                    "conscious",
                    "transcript_quality",
                ],
            },
        },
    },
]

AnswerProvider = Callable[[str], Awaitable[str]]


class AgentUnavailable(Exception):
    """Raised whenever the Groq-backed loop can't be trusted to finish."""


# ---------------------------------------------------------------------------
# Answer providers — pluggable so the same loop works for rehearsal
# (scripted) and a live demo (a human typing replies).
# ---------------------------------------------------------------------------

_SCRIPTED_ANSWERS = {
    "breath": "They're breathing, but it sounds shallow and fast.",
    "conscious": "Yes, they're awake and responding to me.",
    "bleed": "No visible bleeding that I can see.",
    "chok": "No, they're not choking, they can talk.",
}


async def scripted_answer_provider(question: str) -> str:
    """Rehearsal-safe fallback: keyword-matches the question to a canned
    answer so the loop never hangs waiting on stdin during a dry run."""
    q = question.lower()
    for keyword, answer in _SCRIPTED_ANSWERS.items():
        if keyword in q:
            return answer
    return "I'm not sure, I don't have more information than what I already told you."


async def live_stdin_answer_provider(question: str) -> str:
    """Live-demo mode: a human on the keyboard plays the caller."""
    print(f"\n[AGENT ASKS] {question}")
    loop = asyncio.get_event_loop()
    answer = await loop.run_in_executor(None, input, "[CALLER ANSWERS] ")
    return answer


def get_default_answer_provider() -> AnswerProvider:
    mode = os.environ.get("INTAKE_ANSWER_MODE", "scripted")
    if mode == "live":
        return live_stdin_answer_provider
    return scripted_answer_provider


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------


async def run_agent_loop(
    initial_statement: str,
    answer_provider: Optional[AnswerProvider] = None,
    groq_client=None,
) -> tuple[ExtractedFacts, list[str], list[str]]:
    """Runs the bounded tool-calling loop.

    Returns (facts, questions_asked, answers_received).
    Raises AgentUnavailable if Groq can't be used at all, so the caller
    can fall back to the deterministic path.
    """
    if answer_provider is None:
        answer_provider = get_default_answer_provider()

    if groq_client is None:
        groq_client = _build_groq_client()

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": initial_statement},
    ]

    questions_asked: list[str] = []
    answers_received: list[str] = []
    follow_ups_used = 0

    try:
        while True:
            force_submit = follow_ups_used >= MAX_FOLLOW_UPS
            response = await asyncio.wait_for(
                _call_groq(
                    groq_client,
                    messages,
                    tool_choice="required"
                    if not force_submit
                    else {
                        "type": "function",
                        "function": {"name": "submit_facts"},
                    },
                ),
                timeout=GROQ_TIMEOUT_SECONDS,
            )

            message = response.choices[0].message
            tool_calls = getattr(message, "tool_calls", None)

            if not tool_calls:
                # Model replied with plain text instead of a tool call —
                # nudge it once, but never loop forever on this.
                raise AgentUnavailable("model did not return a tool call")

            call = tool_calls[0]
            args = json.loads(call.function.arguments)

            messages.append(
                {
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {
                                "name": call.function.name,
                                "arguments": call.function.arguments,
                            },
                        }
                    ],
                }
            )

            if call.function.name == "submit_facts":
                facts = ExtractedFacts(**args)
                return facts, questions_asked, answers_received

            if call.function.name == "ask_follow_up":
                if follow_ups_used >= MAX_FOLLOW_UPS:
                    # Should not happen given force_submit above, but keep
                    # the bound airtight regardless of model behavior.
                    raise AgentUnavailable(
                        "model kept asking past the follow-up bound"
                    )
                question = args["question"]
                follow_ups_used += 1
                questions_asked.append(question)

                answer = await answer_provider(question)
                answers_received.append(answer)

                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": answer,
                    }
                )
                continue

            raise AgentUnavailable(f"unexpected tool call: {call.function.name}")

    except AgentUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 — any Groq/network failure falls back
        raise AgentUnavailable(str(exc)) from exc


def _build_groq_client():
    if not GROQ_API_KEY:
        raise AgentUnavailable("GROQ_API_KEY not configured")
    from groq import AsyncGroq  # imported lazily so tests can run without it

    return AsyncGroq(api_key=GROQ_API_KEY)


async def _call_groq(client, messages, tool_choice):
    return await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        tools=TOOLS,
        tool_choice=tool_choice,
    )


# ---------------------------------------------------------------------------
# Dispatch handoff
# ---------------------------------------------------------------------------


def build_raw_transcript(
    initial_statement: str, questions: list[str], answers: list[str]
) -> str:
    """Concatenates the initial statement plus every Q&A pair in order,
    so anything downstream that re-reads raw_transcript sees full context."""
    parts = [initial_statement]
    for q, a in zip(questions, answers):
        parts.append(f"Q: {q}")
        parts.append(f"A: {a}")
    return "\n".join(parts)


async def call_dispatch(
    call_id: str, raw_transcript: str, caller_lat: float, caller_lng: float
) -> dict:
    payload = {
        "call_id": call_id,
        "raw_transcript": raw_transcript,
        "caller_lat": caller_lat,
        "caller_lng": caller_lng,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(f"{CORE_ORCHESTRATOR_URL}/dispatch", json=payload)
        resp.raise_for_status()
        return resp.json()
