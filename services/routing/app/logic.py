"""Route estimation with a labeled fallback ladder (Design Law 4):
external traffic-aware provider (if AEGIS_ROUTING_API_KEY is configured) ->
Haversine + average-speed heuristic. The tool signature never changes
between rungs of the ladder, so swapping providers never touches the
orchestrator.
"""

from __future__ import annotations

import math
import os

import httpx
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv(usecwd=True))

AVERAGE_SPEED_KMH = 40.0
TRAFFIC_PENALTY_FACTOR = 1.35  # applied when traffic_aware=True, no live provider

MAPBOX_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}"
MAPBOX_TIMEOUT_S = 3.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r_km = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r_km * math.asin(math.sqrt(a))


def route_estimate_haversine_fallback(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    traffic_aware: bool = True,
) -> dict:
    distance_km = haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    eta_minutes = (distance_km / AVERAGE_SPEED_KMH) * 60.0
    if traffic_aware:
        eta_minutes *= TRAFFIC_PENALTY_FACTOR
    return {
        "distance_km": round(distance_km, 3),
        "eta_minutes": round(eta_minutes, 2),
        "data_source": "haversine_fallback",
    }


def route_estimate_live_provider(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    traffic_aware: bool = True,
) -> dict:
    """Mapbox Directions API (driving-traffic profile). Only attempted
    when MAPBOX_API_KEY is configured; any failure here (missing key,
    timeout, bad response, no route found) is caught by the caller and
    falls back to Haversine immediately, no retry loop, per Design Law 4.
    """
    api_key = os.environ.get("MAPBOX_API_KEY")
    if not api_key:
        raise RuntimeError("No live routing provider configured (MAPBOX_API_KEY unset)")

    # Mapbox wants "lng,lat" pairs, the reverse of this service's signature.
    coords = f"{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
    profile = "driving-traffic" if traffic_aware else "driving"
    profile_url = MAPBOX_DIRECTIONS_URL.format(profile=profile, coords=coords)
    response = httpx.get(
        profile_url,
        params={"access_token": api_key, "overview": "false"},
        timeout=MAPBOX_TIMEOUT_S,
    )
    response.raise_for_status()
    payload = response.json()
    routes = payload.get("routes") or []
    if not routes:
        raise RuntimeError(f"Mapbox returned no route: {payload.get('code')}")

    route = routes[0]
    return {
        "distance_km": round(route["distance"] / 1000.0, 3),
        "eta_minutes": round(route["duration"] / 60.0, 2),
        "data_source": f"mapbox_{profile.replace('-', '_')}",
    }


def route_estimate(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    traffic_aware: bool = True,
) -> dict:
    try:
        return route_estimate_live_provider(
            origin_lat, origin_lng, dest_lat, dest_lng, traffic_aware
        )
    except Exception:
        return route_estimate_haversine_fallback(
            origin_lat, origin_lng, dest_lat, dest_lng, traffic_aware
        )
