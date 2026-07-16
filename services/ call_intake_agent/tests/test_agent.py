"""
Tests for call_intake_agent.

Run with: pytest services/call_intake_agent/tests -v
(install services/call_intake_agent/requirements-dev.txt first)
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import respx
from httpx import Response

from app.agent import (
    AgentUnavailable,
    MAX_FOLLOW_UPS,
    build_raw_transcript,
    call_dispatch,
    run_agent_loop,
)


def _tool_call_response(name: str, arguments: dict):
    """Builds a fake Groq chat.completions.create() response with a single
    tool call, matching the shape agent.py expects (message.tool_calls)."""
    tool_call = SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments)),
    )
    message = SimpleNamespace(content=None, tool_calls=[tool_call])
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


class AlwaysAsksClient:
    """Fake Groq client that always tries to ask another follow-up —
    unless tool_choice forces submit_facts, matching real tool_choice
    behavior. Used to prove the loop can't run past MAX_FOLLOW_UPS."""

    def __init__(self):
        self.calls = 0
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=self._create)
        )

    async def _create(self, model, messages, tools, tool_choice):
        self.calls += 1
        forced = isinstance(tool_choice, dict) and tool_choice.get(
            "function", {}
        ).get("name") == "submit_facts"
        if forced:
            return _tool_call_response(
                "submit_facts",
                {
                    "chief_complaint": "UNKNOWN",
                    "breathing_normally": None,
                    "major_bleeding": None,
                    "conscious": None,
                    "transcript_quality": "POOR",
                },
            )
        return _tool_call_response("ask_follow_up", {"question": "Still unsure — can you tell me more?"})


@pytest.mark.asyncio
async def test_loop_never_exceeds_follow_up_bound():
    client = AlwaysAsksClient()

    async def instant_answer(question: str) -> str:
        return "I don't know."

    facts, questions, answers = await run_agent_loop(
        "Someone collapsed, not sure what's wrong.",
        answer_provider=instant_answer,
        groq_client=client,
    )

    assert len(questions) <= MAX_FOLLOW_UPS
    assert len(questions) == MAX_FOLLOW_UPS  # this fake always tries to ask
    assert facts.chief_complaint == "UNKNOWN"
    assert facts.transcript_quality == "POOR"


class ImmediateSubmitClient:
    """Fake Groq client for the 'clear statement, no questions needed'
    case — submit_facts is called on the very first turn."""

    def __init__(self):
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(create=self._create)
        )

    async def _create(self, model, messages, tools, tool_choice):
        return _tool_call_response(
            "submit_facts",
            {
                "chief_complaint": "CHOKING",
                "breathing_normally": False,
                "major_bleeding": False,
                "conscious": True,
                "transcript_quality": "CLEAR",
            },
        )


@pytest.mark.asyncio
async def test_clear_statement_does_not_ask_unnecessary_questions():
    client = ImmediateSubmitClient()

    async def should_not_be_called(question: str) -> str:
        raise AssertionError("answer_provider should not be invoked")

    facts, questions, answers = await run_agent_loop(
        "My son is choking on food right now, he's conscious but can't breathe.",
        answer_provider=should_not_be_called,
        groq_client=client,
    )

    assert questions == []
    assert answers == []
    assert facts.chief_complaint == "CHOKING"


@pytest.mark.asyncio
async def test_groq_failure_raises_agent_unavailable():
    class BrokenClient:
        def __init__(self):
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=self._create)
            )

        async def _create(self, *args, **kwargs):
            raise ConnectionError("groq unreachable")

    with pytest.raises(AgentUnavailable):
        await run_agent_loop(
            "Test statement", answer_provider=AsyncMock(), groq_client=BrokenClient()
        )


@pytest.mark.asyncio
@respx.mock
async def test_fallback_path_still_reaches_dispatch(monkeypatch):
    monkeypatch.setenv("CORE_ORCHESTRATOR_URL", "http://core_orchestrator:8000")
    import importlib
    import app.agent as agent_module
    importlib.reload(agent_module)

    route = respx.post("http://core_orchestrator:8000/dispatch").mock(
        return_value=Response(200, json={"status": "DISPATCHED", "unit": "amb-1"})
    )

    raw_transcript = build_raw_transcript("Caller statement only", [], [])
    result = await agent_module.call_dispatch(
        call_id="call-123",
        raw_transcript=raw_transcript,
        caller_lat=19.07,
        caller_lng=72.87,
    )

    assert route.called
    assert result["status"] == "DISPATCHED"
    assert raw_transcript == "Caller statement only"
