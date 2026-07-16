"""Repeatable seed of the Supabase tables from app/fixtures.py.
Run after applying every SQL file in migrations/ in numeric order:

    py seed.py
"""

from __future__ import annotations

from aegis_contracts.supabase_client import get_client

from app.fixtures import AMBULANCES, DEMAND_ZONES, HOSPITALS


def main() -> None:
    client = get_client()
    client.table("ambulances").upsert(AMBULANCES).execute()
    client.table("hospitals").upsert(HOSPITALS).execute()
    client.table("demand_zones").upsert(DEMAND_ZONES).execute()
    print(
        f"Seeded {len(AMBULANCES)} ambulances, {len(HOSPITALS)} hospitals, "
        f"and {len(DEMAND_ZONES)} demand zones."
    )


if __name__ == "__main__":
    main()
