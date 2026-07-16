"""Idempotent reservation store backed by Supabase's `reservations` table
(see services/hospital_ambulance_data/migrations/001_schema.sql). Two
unique constraints do the real work here, enforced by Postgres rather
than in-process locking, so this is now safe across multiple
core-orchestrator instances (a prerequisite for run_batch's
fleet-contention stress test):

- `call_id` unique -> re-invoking reserve() for the same call is
  idempotent, returns the same reservation instead of erroring.
- `ambulance_id` unique -> a concurrent attempt to book the same unit on
  a different call is rejected by the database, not by a Python lock.
"""

from __future__ import annotations

from aegis_contracts import Reservation
from aegis_contracts.supabase_client import get_client


def _row_to_reservation(row: dict) -> Reservation:
    return Reservation(
        reservation_id=row["reservation_id"],
        ambulance_id=row["ambulance_id"],
        hospital_id=row["hospital_id"],
        idempotency_key=row["call_id"],
        confirmed=row["confirmed"],
    )


def reserve(call_id: str, ambulance_id: str, hospital_id: str) -> tuple[Reservation, bool]:
    """Returns (reservation, already_existed)."""
    client = get_client()

    existing = client.table("reservations").select("*").eq("call_id", call_id).execute().data
    if existing:
        return _row_to_reservation(existing[0]), True

    try:
        result = (
            client.table("reservations")
            .insert(
                {
                    "reservation_id": f"res-{call_id}",
                    "call_id": call_id,
                    "ambulance_id": ambulance_id,
                    "hospital_id": hospital_id,
                    "confirmed": True,
                }
            )
            .execute()
        )
    except Exception as exc:
        if "duplicate key" not in str(exc).lower() and "unique" not in str(exc).lower():
            raise
        # Lost a race. If it was OUR call_id that got inserted concurrently,
        # this is still idempotent -- return the winner's row. Otherwise the
        # ambulance itself was booked on a different call; that's a real
        # double-book attempt and must fail loudly.
        existing = client.table("reservations").select("*").eq("call_id", call_id).execute().data
        if existing:
            return _row_to_reservation(existing[0]), True
        raise RuntimeError(f"Ambulance {ambulance_id} is already booked on another call") from exc

    return _row_to_reservation(result.data[0]), False


def release(call_id: str) -> None:
    get_client().table("reservations").delete().eq("call_id", call_id).execute()
