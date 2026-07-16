"""eligible_ambulances/eligible_hospitals/hospital_capacity now query
Supabase directly, so these are integration tests against the real
seeded database (run `py seed.py` once first) -- they skip cleanly when
no Supabase credentials are configured rather than failing the suite.
"""

import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from supabase import create_client

from app import logic
from app.fixtures import DEMAND_ZONES, DEMO_PATIENT_LAT, DEMO_PATIENT_LNG, HOSPITALS

requires_supabase = pytest.mark.skipif(
    not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
    reason="SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured",
)


def test_haversine_km_is_symmetric_and_zero_for_same_point():
    assert logic.haversine_km(42.36, -71.05, 42.36, -71.05) == 0
    forward = logic.haversine_km(42.36, -71.05, 42.40, -71.10)
    backward = logic.haversine_km(42.40, -71.10, 42.36, -71.05)
    assert forward == pytest.approx(backward)
    assert forward > 0


def test_trauma_hospital_fixture_is_a_valid_cardiac_fallback():
    trauma = next(hospital for hospital in HOSPITALS if hospital["id"] == "hosp-trauma")

    assert "cardiac" in trauma["specialties"]
    assert trauma["bed_count"] > 0
    assert trauma["status"] == "OPEN"
    assert (
        logic.haversine_km(
            DEMO_PATIENT_LAT,
            DEMO_PATIENT_LNG,
            trauma["lat"],
            trauma["lng"],
        )
        <= 25.0
    )


def test_demand_zone_fixtures_have_positive_nearby_signal():
    assert len({zone["id"] for zone in DEMAND_ZONES}) == len(DEMAND_ZONES)
    assert all(zone["historical_calls_7d"] > 0 for zone in DEMAND_ZONES)
    assert all(
        logic.haversine_km(
            DEMO_PATIENT_LAT,
            DEMO_PATIENT_LNG,
            zone["lat"],
            zone["lng"],
        )
        <= 15.0
        for zone in DEMAND_ZONES
    )


@pytest.mark.parametrize("status", ["CLOSED", "open", ""])
def test_set_hospital_status_rejects_invalid_status_before_query(monkeypatch, status):
    def fail_if_called():
        pytest.fail("invalid status should be rejected before querying Supabase")

    monkeypatch.setattr(logic, "get_client", fail_if_called)

    with pytest.raises(ValueError, match="Invalid hospital status"):
        logic.set_hospital_status("hosp-cardiac-center", status)


@pytest.mark.parametrize(
    ("max_recommendations", "max_relocation_km"),
    [(0, 15.0), (-1, 15.0), (3, 0), (3, -1.0)],
)
def test_relocation_recommendations_reject_invalid_limits_before_query(
    monkeypatch, max_recommendations, max_relocation_km
):
    def fail_if_called():
        pytest.fail("invalid limits should be rejected before querying Supabase")

    monkeypatch.setattr(logic, "_fetch_idle_ambulances", fail_if_called)
    monkeypatch.setattr(logic, "_fetch_demand_zones", fail_if_called)

    with pytest.raises(ValueError, match="greater than 0"):
        logic.relocation_recommendations(max_recommendations, max_relocation_km)


def test_idle_ambulances_exclude_available_units_with_reservations(monkeypatch):
    monkeypatch.setattr(
        logic,
        "_fetch_ambulances",
        lambda: [{"id": "unit-free"}, {"id": "unit-reserved"}],
    )
    monkeypatch.setattr(logic, "_fetch_reserved_ambulance_ids", lambda: {"unit-reserved"})

    assert logic._fetch_idle_ambulances() == [{"id": "unit-free"}]


def test_relocation_recommendations_rank_demand_and_assign_unique_nearest_units(monkeypatch):
    back_bay_lat = 42.3493
    back_bay_lng = -71.0810
    idle_ambulances = [
        {
            "id": "unit-b",
            "lat": DEMO_PATIENT_LAT,
            "lng": DEMO_PATIENT_LNG,
            "capability": "ALS",
        },
        {
            "id": "unit-a",
            "lat": DEMO_PATIENT_LAT,
            "lng": DEMO_PATIENT_LNG,
            "capability": "BLS",
        },
        {
            "id": "unit-c",
            "lat": back_bay_lat,
            "lng": back_bay_lng,
            "capability": "ALS",
        },
    ]
    zones = [
        {
            "id": "zone-medium",
            "name": "Medium demand",
            "lat": back_bay_lat,
            "lng": back_bay_lng,
            "historical_calls_7d": 84,
        },
        {
            "id": "zone-hot",
            "name": "Highest demand",
            "lat": DEMO_PATIENT_LAT,
            "lng": DEMO_PATIENT_LNG,
            "historical_calls_7d": 168,
        },
    ]
    monkeypatch.setattr(logic, "_fetch_idle_ambulances", lambda: idle_ambulances)
    monkeypatch.setattr(logic, "_fetch_demand_zones", lambda: zones)

    result = logic.relocation_recommendations(max_recommendations=2)
    recommendations = result["recommendations"]

    assert result["advisory_only"] is True
    assert result["requires_revalidation"] is True
    assert result["data_source"] == "supabase_demand_zones"
    assert [item["target_zone_id"] for item in recommendations] == [
        "zone-hot",
        "zone-medium",
    ]
    assert [item["ambulance_id"] for item in recommendations] == ["unit-a", "unit-c"]
    assert recommendations[0]["predicted_calls_next_hour"] == 1.0
    assert recommendations[1]["predicted_calls_next_hour"] == 0.5
    assert len({item["ambulance_id"] for item in recommendations}) == len(recommendations)


def test_relocation_recommendations_are_deterministic_and_respect_radius(monkeypatch):
    monkeypatch.setattr(
        logic,
        "_fetch_idle_ambulances",
        lambda: [
            {
                "id": "unit-1",
                "lat": DEMO_PATIENT_LAT,
                "lng": DEMO_PATIENT_LNG,
                "capability": "ALS",
            }
        ],
    )
    monkeypatch.setattr(
        logic,
        "_fetch_demand_zones",
        lambda: [
            {
                "id": "zone-z",
                "name": "Same count, later id",
                "lat": DEMO_PATIENT_LAT,
                "lng": DEMO_PATIENT_LNG,
                "historical_calls_7d": 10,
            },
            {
                "id": "zone-a",
                "name": "Same count, earlier id",
                "lat": DEMO_PATIENT_LAT,
                "lng": DEMO_PATIENT_LNG,
                "historical_calls_7d": 10,
            },
        ],
    )

    result = logic.relocation_recommendations(max_relocation_km=1.0)
    assert result["recommendations"][0]["target_zone_id"] == "zone-a"

    monkeypatch.setattr(
        logic,
        "_fetch_demand_zones",
        lambda: [
            {
                "id": "zone-far",
                "name": "Outside radius",
                "lat": 42.4000,
                "lng": -71.1000,
                "historical_calls_7d": 10,
            }
        ],
    )
    far_result = logic.relocation_recommendations(max_relocation_km=1.0)
    assert far_result["recommendations"] == []


@requires_supabase
def test_nearest_ambulance_is_bls_but_als_filter_excludes_it():
    naive = logic.nearest_ignoring_constraints(DEMO_PATIENT_LAT, DEMO_PATIENT_LNG)
    assert naive["ambulance"]["capability"] == "BLS"

    als_only = logic.eligible_ambulances(DEMO_PATIENT_LAT, DEMO_PATIENT_LNG, requires_als=True)
    assert all(a["capability"] == "ALS" for a in als_only)
    assert naive["ambulance"]["id"] not in {a["id"] for a in als_only}


@requires_supabase
def test_nearest_hospital_lacks_cardiac_but_filter_excludes_it():
    naive = logic.nearest_ignoring_constraints(DEMO_PATIENT_LAT, DEMO_PATIENT_LNG)
    assert "cardiac" not in naive["hospital"]["specialties"]

    cardiac_only = logic.eligible_hospitals(
        DEMO_PATIENT_LAT, DEMO_PATIENT_LNG, required_specialty="cardiac"
    )
    assert all("cardiac" in h["specialties"] for h in cardiac_only)
    assert naive["hospital"]["id"] not in {h["id"] for h in cardiac_only}


@requires_supabase
def test_hospital_capacity_lookup():
    cap = logic.hospital_capacity("hosp-cardiac-center")
    assert cap["bed_count"] == 3


@requires_supabase
def test_seeded_trauma_hospital_is_returned_by_default_cardiac_search():
    eligible = logic.eligible_hospitals(
        DEMO_PATIENT_LAT,
        DEMO_PATIENT_LNG,
        required_specialty="cardiac",
    )

    assert "hosp-trauma" in {hospital["id"] for hospital in eligible}


@requires_supabase
def test_relocation_recommendations_use_seeded_zones_without_mutating_fleet():
    client = logic.get_client()
    before = sorted(client.table("ambulances").select("*").execute().data, key=lambda row: row["id"])

    result = logic.relocation_recommendations()

    after = sorted(client.table("ambulances").select("*").execute().data, key=lambda row: row["id"])
    seeded_zone_ids = {zone["id"] for zone in DEMAND_ZONES}
    live_zone_ids = {
        zone["id"] for zone in client.table("demand_zones").select("id").execute().data
    }
    reserved_ids = logic._fetch_reserved_ambulance_ids()

    assert before == after
    assert seeded_zone_ids <= live_zone_ids
    assert all(
        recommendation["ambulance_id"] not in reserved_ids
        for recommendation in result["recommendations"]
    )


@requires_supabase
def test_set_hospital_status_controls_hospital_eligibility():
    suffix = uuid.uuid4().hex
    hospital_id = f"test-hospital-{suffix}"
    specialty = f"test-specialty-{suffix}"
    client = logic.get_client()
    client.table("hospitals").insert(
        {
            "id": hospital_id,
            "lat": DEMO_PATIENT_LAT,
            "lng": DEMO_PATIENT_LNG,
            "bed_count": 1,
            "specialties": [specialty],
            "status": "OPEN",
        }
    ).execute()

    try:
        assert hospital_id in {
            hospital["id"]
            for hospital in logic.eligible_hospitals(
                DEMO_PATIENT_LAT,
                DEMO_PATIENT_LNG,
                required_specialty=specialty,
            )
        }

        diverted = logic.set_hospital_status(hospital_id, "DIVERSION")
        assert diverted == logic.hospital_capacity(hospital_id)
        assert hospital_id not in {
            hospital["id"]
            for hospital in logic.eligible_hospitals(
                DEMO_PATIENT_LAT,
                DEMO_PATIENT_LNG,
                required_specialty=specialty,
            )
        }

        reopened = logic.set_hospital_status(hospital_id, "OPEN")
        assert reopened == logic.hospital_capacity(hospital_id)
        assert hospital_id in {
            hospital["id"]
            for hospital in logic.eligible_hospitals(
                DEMO_PATIENT_LAT,
                DEMO_PATIENT_LNG,
                required_specialty=specialty,
            )
        }
    finally:
        client.table("hospitals").delete().eq("id", hospital_id).execute()


@requires_supabase
def test_set_hospital_status_rejects_unknown_hospital():
    with pytest.raises(ValueError, match="Unknown hospital_id"):
        logic.set_hospital_status(f"missing-{uuid.uuid4().hex}", "DIVERSION")


def _postgres_error_code(exc: Exception) -> str | None:
    code = getattr(exc, "code", None)
    if code is not None:
        return str(code)
    if exc.args and isinstance(exc.args[0], dict):
        raw_code = exc.args[0].get("code")
        return str(raw_code) if raw_code is not None else None
    return None


@requires_supabase
def test_reservations_reject_concurrent_double_booking():
    suffix = uuid.uuid4().hex
    ambulance_id = f"test-ambulance-{suffix}"
    hospital_id = f"test-hospital-{suffix}"
    attempts = 6
    barrier = threading.Barrier(attempts)
    client = logic.get_client()

    client.table("hospitals").insert(
        {
            "id": hospital_id,
            "lat": DEMO_PATIENT_LAT,
            "lng": DEMO_PATIENT_LNG,
            "bed_count": 1,
            "specialties": ["general"],
            "status": "OPEN",
        }
    ).execute()
    try:
        client.table("ambulances").insert(
            {
                "id": ambulance_id,
                "lat": DEMO_PATIENT_LAT,
                "lng": DEMO_PATIENT_LNG,
                "capability": "ALS",
                "status": "AVAILABLE",
            }
        ).execute()
    except Exception:
        client.table("hospitals").delete().eq("id", hospital_id).execute()
        raise

    def insert_reservation(index: int) -> tuple[str, object]:
        worker_client = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        barrier.wait(timeout=10)
        try:
            result = worker_client.table("reservations").insert(
                {
                    "reservation_id": f"test-reservation-{suffix}-{index}",
                    "call_id": f"test-call-{suffix}-{index}",
                    "ambulance_id": ambulance_id,
                    "hospital_id": hospital_id,
                    "confirmed": True,
                }
            ).execute()
            return "success", result.data
        except Exception as exc:  # Supabase raises APIError for Postgres constraint failures.
            return "error", exc

    try:
        with ThreadPoolExecutor(max_workers=attempts) as executor:
            results = list(executor.map(insert_reservation, range(attempts)))

        successes = [value for outcome, value in results if outcome == "success"]
        failures = [value for outcome, value in results if outcome == "error"]

        assert len(successes) == 1
        assert len(failures) == attempts - 1
        assert successes[0][0]["ambulance_id"] == ambulance_id
        assert all(_postgres_error_code(exc) == "23505" for exc in failures)
    finally:
        client.table("reservations").delete().eq("ambulance_id", ambulance_id).execute()
        client.table("ambulances").delete().eq("id", ambulance_id).execute()
        client.table("hospitals").delete().eq("id", hospital_id).execute()
