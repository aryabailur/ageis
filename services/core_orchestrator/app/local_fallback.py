"""Design Law 4 at the orchestrator's call boundary: if the
hospital_ambulance_data or routing microservice is unreachable, degrade to
a small cached snapshot instead of failing the whole dispatch. This is a
deliberately stale, deliberately tiny copy — good enough to keep the
demo/clean path alive, never used when the real service answers in time.
"""

from __future__ import annotations

import math

CACHED_AMBULANCES = [
    {"id": "unit-7", "lat": 42.3550, "lng": -71.0700, "capability": "ALS", "status": "AVAILABLE"},
]

CACHED_HOSPITALS = [
    {
        "id": "hosp-cardiac-center",
        "lat": 42.3520,
        "lng": -71.0750,
        "bed_count": 3,
        "specialties": ["general", "cardiac"],
        "status": "OPEN",
    },
]


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r_km = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r_km * math.asin(math.sqrt(a))


def cached_eligible_ambulances(lat: float, lng: float, requires_als: bool = False) -> list[dict]:
    out = [a for a in CACHED_AMBULANCES if not requires_als or a["capability"] == "ALS"]
    return [{**a, "distance_km": round(_haversine_km(lat, lng, a["lat"], a["lng"]), 3)} for a in out]


def cached_eligible_hospitals(lat: float, lng: float, required_specialty: str | None = None) -> list[dict]:
    out = [h for h in CACHED_HOSPITALS if not required_specialty or required_specialty in h["specialties"]]
    return [{**h, "distance_km": round(_haversine_km(lat, lng, h["lat"], h["lng"]), 3)} for h in out]


def cached_route_estimate(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> dict:
    distance_km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    return {
        "distance_km": round(distance_km, 3),
        "eta_minutes": round((distance_km / 40.0) * 60.0 * 1.35, 2),
        "data_source": "cached_snapshot_fallback",
    }
