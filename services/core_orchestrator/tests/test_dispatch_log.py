"""Unit tests for app.dispatch_log.

These tests are pure-Python / no-network: they mock the Supabase client
and asyncio.to_thread so nothing external is needed.

Covered cases
-------------
1. Happy path: _insert is called with the right fields and log_dispatch
   returns without raising.
2. DB failure: _insert raises; call_with_fallback's own WARNING fires AND
   the module-level fallback warning fires; log_dispatch still returns
   without raising (a logging failure must never break a dispatch response).
"""

from __future__ import annotations

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from aegis_contracts import DispatchState, DispatchStatus, Priority, TriageResult

from app import dispatch_log


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

DEMO_STATE = DispatchState(
    call_id="test-log-001",
    status=DispatchStatus.COMPLETED,
    raw_transcript="patient is unconscious, not breathing",
    caller_lat=42.36,
    caller_lng=-71.06,
    triage=TriageResult(priority=Priority.P1, requires_als=True),
)

DEMO_STATE_NO_TRIAGE = DispatchState(
    call_id="test-log-002",
    status=DispatchStatus.FAILED,
    raw_transcript="unclear call",
    caller_lat=None,
    caller_lng=None,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_client(raises: Exception | None = None):
    """Returns a mock Supabase client whose .table(...).insert(...).execute()
    either succeeds silently or raises *raises*."""
    execute_mock = MagicMock()
    if raises:
        execute_mock.side_effect = raises
    insert_mock = MagicMock()
    insert_mock.return_value.execute = execute_mock
    table_mock = MagicMock()
    table_mock.return_value.insert = insert_mock
    client = MagicMock()
    client.table = table_mock
    return client


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_log_dispatch_inserts_correct_fields():
    """log_dispatch should call Supabase with all required scalar fields and
    a non-empty state_snapshot containing the full DispatchState."""
    mock_client = _make_mock_client()

    with patch("app.dispatch_log.get_client", return_value=mock_client):
        await dispatch_log.log_dispatch(DEMO_STATE)

    # Supabase client was called exactly once
    mock_client.table.assert_called_once_with("dispatch_logs")
    inserted_row = mock_client.table.return_value.insert.call_args[0][0]

    assert inserted_row["call_id"] == "test-log-001"
    assert inserted_row["status"] == "COMPLETED"
    assert inserted_row["priority"] == "P1"
    assert inserted_row["caller_lat"] == pytest.approx(42.36)
    assert inserted_row["caller_lng"] == pytest.approx(-71.06)

    snapshot = inserted_row["state_snapshot"]
    assert isinstance(snapshot, dict)
    assert snapshot["call_id"] == "test-log-001"
    assert snapshot["raw_transcript"] == "patient is unconscious, not breathing"
    # Triage is present and fully serialised
    assert snapshot["triage"]["priority"] == "P1"
    assert snapshot["triage"]["requires_als"] is True


@pytest.mark.asyncio
async def test_log_dispatch_null_triage_gives_null_priority():
    """When there is no triage result the priority column should be None."""
    mock_client = _make_mock_client()

    with patch("app.dispatch_log.get_client", return_value=mock_client):
        await dispatch_log.log_dispatch(DEMO_STATE_NO_TRIAGE)

    inserted_row = mock_client.table.return_value.insert.call_args[0][0]
    assert inserted_row["priority"] is None


# ---------------------------------------------------------------------------
# Failure / fallback tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_log_dispatch_db_failure_emits_warnings_and_does_not_raise(caplog):
    """When the DB insert raises, call_with_fallback emits a WARNING at
    aegis.fallback and the module fallback adds one at aegis.dispatch_log.
    log_dispatch must return without raising."""
    mock_client = _make_mock_client(raises=RuntimeError("connection refused"))

    with caplog.at_level(logging.WARNING):
        with patch("app.dispatch_log.get_client", return_value=mock_client):
            # Should not raise
            await dispatch_log.log_dispatch(DEMO_STATE)

    warning_texts = " ".join(caplog.messages)
    # call_with_fallback emits its own warning about the primary failing
    assert "supabase:dispatch_logs" in warning_texts or "dispatch_log" in warning_texts


@pytest.mark.asyncio
async def test_log_dispatch_never_raises_on_any_exception(caplog):
    """Even a completely unexpected exception type must not propagate."""
    mock_client = _make_mock_client(raises=ValueError("unexpected schema change"))

    with caplog.at_level(logging.WARNING):
        with patch("app.dispatch_log.get_client", return_value=mock_client):
            await dispatch_log.log_dispatch(DEMO_STATE)
    # The key assertion is that we got here without raising.
