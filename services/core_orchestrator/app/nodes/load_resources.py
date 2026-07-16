"""Calls the hospital_ambulance_data plugin over MCP, resolved purely by
name through the shared registry. Falls back to a small cached snapshot
(Design Law 4) if the service is unreachable within the timeout.
"""

from __future__ import annotations

from aegis_contracts import DispatchState, TimingEntry, load_default_registry
from aegis_contracts.fallback import call_with_fallback
from aegis_contracts.timing import clock

from .. import local_fallback
from ..mcp_client import call_tool

SERVICE_NAME = "hospital_ambulance_data"


async def load_resources(state: DispatchState) -> dict:
    start = clock()
    registry = load_default_registry()
    service = registry.get(SERVICE_NAME)
    incident, triage = state.incident, state.triage
    lat, lng = incident.location_lat, incident.location_lng

    async def call_ambulances():
        return await call_tool(
            service.base_url,
            "get_eligible_ambulances",
            {"lat": lat, "lng": lng, "requires_als": triage.requires_als},
        )

    async def call_hospitals():
        return await call_tool(
            service.base_url,
            "get_eligible_hospitals",
            {"lat": lat, "lng": lng, "required_specialty": triage.required_hospital_specialty},
        )

    amb_result = await call_with_fallback(
        call_ambulances,
        lambda: local_fallback.cached_eligible_ambulances(lat, lng, triage.requires_als),
        primary_label=f"mcp:{SERVICE_NAME}",
        fallback_label="cached_snapshot_fallback",
    )
    hosp_result = await call_with_fallback(
        call_hospitals,
        lambda: local_fallback.cached_eligible_hospitals(lat, lng, triage.required_hospital_specialty),
        primary_label=f"mcp:{SERVICE_NAME}",
        fallback_label="cached_snapshot_fallback",
    )

    entry = TimingEntry(step="load_resources", start=start, end=clock())
    return {
        "available_ambulances": amb_result.value,
        "available_hospitals": hosp_result.value,
        "resource_data_source": (amb_result.data_source, hosp_result.data_source),
        "timing_log": state.timing_log + [entry],
    }
