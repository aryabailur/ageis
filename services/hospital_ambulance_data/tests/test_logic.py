"""eligible_ambulances/eligible_hospitals/hospital_capacity now query
Supabase directly, so these are integration tests against the real
seeded database (run `py seed.py` once first) -- they skip cleanly when
no Supabase credentials are configured rather than failing the suite.
"""

import os

import pytest

from app import logic
from app.fixtures import DEMO_PATIENT_LAT, DEMO_PATIENT_LNG

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
