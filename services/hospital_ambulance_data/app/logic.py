"""Tool implementations backed by Supabase. Kept separate from the MCP
transport so they're trivially unit-testable and so this same logic is
what the core-orchestrator's fallback path calls when the MCP round-trip
fails (the fallback there is a small local cached snapshot, not Supabase
again -- see core_orchestrator/app/local_fallback.py).

Simple equality filters (status, capability) are pushed down to Postgres;
radius/specialty/bed_count filtering stays in Python since the fixture
data has no PostGIS extension enabled and specialties is a plain array.
"""

from __future__ import annotations

import math

from aegis_contracts.supabase_client import get_client


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r_km = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r_km * math.asin(math.sqrt(a))


def _fetch_ambulances(requires_als: bool = False) -> list[dict]:
    query = get_client().table("ambulances").select("*").eq("status", "AVAILABLE")
    if requires_als:
        query = query.eq("capability", "ALS")
    return query.execute().data


def _fetch_hospitals() -> list[dict]:
    return get_client().table("hospitals").select("*").eq("status", "OPEN").execute().data


def eligible_ambulances(
    lat: float, lng: float, requires_als: bool = False, max_radius_km: float = 15.0
) -> list[dict]:
    out = []
    for amb in _fetch_ambulances(requires_als):
        dist = haversine_km(lat, lng, amb["lat"], amb["lng"])
        if dist > max_radius_km:
            continue
        out.append({**amb, "distance_km": round(dist, 3)})
    return sorted(out, key=lambda a: a["distance_km"])


def eligible_hospitals(
    lat: float, lng: float, required_specialty: str | None = None, max_radius_km: float = 25.0
) -> list[dict]:
    out = []
    for hosp in _fetch_hospitals():
        if required_specialty and required_specialty not in hosp["specialties"]:
            continue
        if hosp["bed_count"] <= 0:
            continue
        dist = haversine_km(lat, lng, hosp["lat"], hosp["lng"])
        if dist > max_radius_km:
            continue
        out.append({**hosp, "distance_km": round(dist, 3)})
    return sorted(out, key=lambda h: h["distance_km"])


def hospital_capacity(hospital_id: str) -> dict:
    rows = get_client().table("hospitals").select("*").eq("id", hospital_id).execute().data
    if not rows:
        raise ValueError(f"Unknown hospital_id: {hospital_id}")
    return rows[0]


def nearest_ignoring_constraints(lat: float, lng: float) -> dict:
    """The naive baseline used for the demo's quantified comparison: the
    single closest ambulance and hospital with NO capability/status filter
    at all -- queries every row, not just AVAILABLE/OPEN ones. On the
    seeded coordinates this deliberately picks the wrong unit (BLS) and
    the wrong hospital (no cardiac capability)."""
    all_ambulances = get_client().table("ambulances").select("*").execute().data
    all_hospitals = get_client().table("hospitals").select("*").execute().data
    nearest_amb = min(all_ambulances, key=lambda a: haversine_km(lat, lng, a["lat"], a["lng"]))
    nearest_hosp = min(all_hospitals, key=lambda h: haversine_km(lat, lng, h["lat"], h["lng"]))
    return {
        "ambulance": nearest_amb,
        "hospital": nearest_hosp,
        "data_source": "naive_baseline_no_constraints",
    }
