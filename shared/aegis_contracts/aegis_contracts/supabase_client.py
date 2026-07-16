"""Shared Supabase client factory. Any service that needs Supabase
(hospital_ambulance_data for ambulances/hospitals, core_orchestrator for
reservations) gets it from here so there's one place that knows the env
var names and the service-role-key tradeoff: these are trusted backend
services with no end-user auth layer of their own, so they bypass RLS by
design (see services/hospital_ambulance_data/migrations/001_schema.sql).
"""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import find_dotenv, load_dotenv
from supabase import Client, create_client

load_dotenv(find_dotenv(usecwd=True))


@lru_cache(maxsize=1)
def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "Copy .env.example to .env at the repo root and fill them in."
        )
    return create_client(url, key)
