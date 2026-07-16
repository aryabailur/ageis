"""One-time (or repeatable) seed of the Supabase tables from the same
demo data that used to live in fixtures.py. Run after applying
migrations/001_schema.sql:

    py seed.py
"""

from __future__ import annotations

from aegis_contracts.supabase_client import get_client

from app.fixtures import AMBULANCES, HOSPITALS


def main() -> None:
    client = get_client()
    client.table("ambulances").upsert(AMBULANCES).execute()
    client.table("hospitals").upsert(HOSPITALS).execute()
    print(f"Seeded {len(AMBULANCES)} ambulances and {len(HOSPITALS)} hospitals.")


if __name__ == "__main__":
    main()
