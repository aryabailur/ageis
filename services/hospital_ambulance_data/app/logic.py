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


_HOSPITAL_STATUSES = frozenset({"OPEN", "DIVERSION"})


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


def _fetch_demand_zones() -> list[dict]:
    return get_client().table("demand_zones").select("*").execute().data


def _fetch_reserved_ambulance_ids() -> set[str]:
    rows = get_client().table("reservations").select("ambulance_id").execute().data
    return {row["ambulance_id"] for row in rows}


def _fetch_idle_ambulances() -> list[dict]:
    reserved_ids = _fetch_reserved_ambulance_ids()
    return [ambulance for ambulance in _fetch_ambulances() if ambulance["id"] not in reserved_ids]


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


def set_hospital_status(hospital_id: str, status: str) -> dict:
    if status not in _HOSPITAL_STATUSES:
        allowed = ", ".join(sorted(_HOSPITAL_STATUSES))
        raise ValueError(f"Invalid hospital status: {status!r}. Expected one of: {allowed}")

    rows = (
        get_client()
        .table("hospitals")
        .update({"status": status})
        .eq("id", hospital_id)
        .execute()
        .data
    )
    if not rows:
        raise ValueError(f"Unknown hospital_id: {hospital_id}")
    return rows[0]


def relocation_recommendations(
    max_recommendations: int = 3, max_relocation_km: float = 15.0
) -> dict:
    """Recommend where idle units should stage based on seven-day demand.

    This is advisory only: it never changes ambulance coordinates or status.
    Reservations are checked separately because an AVAILABLE unit can already
    be committed to an in-flight dispatch. The two reads are not atomic, so a
    caller must revalidate a recommendation before acting on it.
    """
    if max_recommendations <= 0:
        raise ValueError("max_recommendations must be greater than 0")
    if max_relocation_km <= 0:
        raise ValueError("max_relocation_km must be greater than 0")

    remaining_ambulances = list(_fetch_idle_ambulances())
    ranked_zones = sorted(
        _fetch_demand_zones(),
        key=lambda zone: (-zone["historical_calls_7d"], zone["id"]),
    )
    recommendations = []

    for zone in ranked_zones:
        if len(recommendations) >= max_recommendations or not remaining_ambulances:
            break
        if zone["historical_calls_7d"] <= 0:
            continue

        candidates = []
        for ambulance in remaining_ambulances:
            distance_km = haversine_km(
                ambulance["lat"],
                ambulance["lng"],
                zone["lat"],
                zone["lng"],
            )
            if distance_km <= max_relocation_km:
                candidates.append((distance_km, ambulance["id"], ambulance))

        if not candidates:
            continue

        distance_km, _, ambulance = min(candidates, key=lambda item: (item[0], item[1]))
        remaining_ambulances.remove(ambulance)
        recommendations.append(
            {
                "ambulance_id": ambulance["id"],
                "capability": ambulance["capability"],
                "current_lat": ambulance["lat"],
                "current_lng": ambulance["lng"],
                "target_zone_id": zone["id"],
                "target_zone_name": zone["name"],
                "target_lat": zone["lat"],
                "target_lng": zone["lng"],
                "relocation_distance_km": round(distance_km, 3),
                "historical_calls_7d": zone["historical_calls_7d"],
                "predicted_calls_next_hour": round(zone["historical_calls_7d"] / 168.0, 3),
            }
        )

    return {
        "recommendations": recommendations,
        "advisory_only": True,
        "requires_revalidation": True,
        "data_source": "supabase_demand_zones",
        "forecast_method": "historical_calls_7d / 168",
    }


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
