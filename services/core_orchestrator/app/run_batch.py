"""Drives N DispatchStates concurrently against the shared fleet. This is
what actually stress-tests reservation_store's idempotency/no-double-book
guarantees under real concurrency (the Supabase unique constraints on
call_id and ambulance_id are what make this safe -- see
services/hospital_ambulance_data/migrations/001_schema.sql) rather than
just asserting it in isolation, one call at a time.
"""

from __future__ import annotations

import asyncio
from typing import Any

from aegis_contracts import DispatchState

from .graph import compiled_app


async def run_batch(incidents: list[dict[str, Any]]) -> list[DispatchState | None]:
    """Each dict in `incidents` needs call_id, raw_transcript, caller_lat,
    caller_lng. Returns one result per incident, in the same order; a
    call that raises is returned as None rather than failing the batch,
    so one bad incident doesn't hide the others' results."""
    app = compiled_app()

    async def run_one(incident: dict[str, Any]) -> DispatchState | None:
        initial = DispatchState(**incident)
        try:
            result = await app.ainvoke(initial)
        except Exception:
            return None
        return DispatchState.model_validate(result)

    return await asyncio.gather(*(run_one(incident) for incident in incidents))
