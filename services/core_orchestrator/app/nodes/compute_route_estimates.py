"""Builds every plausible (ambulance, hospital) pairing and asks the
routing plugin for both legs: ambulance -> patient, and patient ->
hospital. Bounded to the closest few of each side so the combinatorics
stay small on the CORE-tier clean path.
"""

from __future__ import annotations

from aegis_contracts import Ambulance, CandidateAssignment, DispatchState, Hospital, TimingEntry, load_default_registry
from aegis_contracts.fallback import call_with_fallback
from aegis_contracts.timing import clock

from .. import local_fallback
from ..mcp_client import call_tool

SERVICE_NAME = "routing"
MAX_AMBULANCES = 3
MAX_HOSPITALS = 2


async def compute_route_estimates(state: DispatchState) -> dict:
    start = clock()
    registry = load_default_registry()
    service = registry.get(SERVICE_NAME)

    lat, lng = state.incident.location_lat, state.incident.location_lng
    ambulances = state.available_ambulances[:MAX_AMBULANCES]
    hospitals = state.available_hospitals[:MAX_HOSPITALS]

    candidates: list[CandidateAssignment] = []
    for amb in ambulances:
        for hosp in hospitals:
            amb_eta = await _route_leg(service.base_url, amb["lat"], amb["lng"], lat, lng)
            hosp_eta = await _route_leg(service.base_url, lat, lng, hosp["lat"], hosp["lng"])
            candidates.append(
                CandidateAssignment(
                    ambulance=Ambulance(**{k: amb[k] for k in ("id", "lat", "lng", "capability", "status")}),
                    hospital=Hospital(
                        **{k: hosp[k] for k in ("id", "lat", "lng", "bed_count", "specialties", "status")}
                    ),
                    ambulance_eta_minutes=amb_eta.value["eta_minutes"],
                    hospital_eta_minutes=hosp_eta.value["eta_minutes"],
                    route_data_source=amb_eta.data_source,
                )
            )

    entry = TimingEntry(step="compute_route_estimates", start=start, end=clock())
    return {"candidates": candidates, "timing_log": state.timing_log + [entry]}


async def _route_leg(base_url: str, origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float):
    async def call_live():
        return await call_tool(
            base_url,
            "get_route_estimate",
            {"origin_lat": origin_lat, "origin_lng": origin_lng, "dest_lat": dest_lat, "dest_lng": dest_lng},
        )

    return await call_with_fallback(
        call_live,
        lambda: local_fallback.cached_route_estimate(origin_lat, origin_lng, dest_lat, dest_lng),
        primary_label=f"mcp:{SERVICE_NAME}",
        fallback_label="cached_snapshot_fallback",
    )
