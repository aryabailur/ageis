"""Demo seed data and the demo patient location, used by seed.py to
populate Supabase and by tests to know what to expect. This is no longer
read at request time -- logic.py queries Supabase directly -- but it's
the single source of truth for what "the seeded state" is.

Coordinates are chosen so the naive nearest-to-nearest baseline is
visibly wrong: the geographically nearest ambulance to the demo patient
is BLS-only, and the nearest hospital lacks cardiac capability.
"""

from __future__ import annotations

DEMO_PATIENT_LAT = 42.3601
DEMO_PATIENT_LNG = -71.0589

AMBULANCES: list[dict] = [
    {"id": "unit-4", "lat": 42.3610, "lng": -71.0595, "capability": "BLS", "status": "AVAILABLE"},
    {"id": "unit-7", "lat": 42.3550, "lng": -71.0700, "capability": "ALS", "status": "AVAILABLE"},
    {"id": "unit-2", "lat": 42.3700, "lng": -71.0400, "capability": "ALS", "status": "AVAILABLE"},
    {"id": "unit-9", "lat": 42.3450, "lng": -71.0900, "capability": "BLS", "status": "ON_CALL"},
]

HOSPITALS: list[dict] = [
    {
        "id": "hosp-general",
        "lat": 42.3615,
        "lng": -71.0580,
        "bed_count": 2,
        "specialties": ["general"],
        "status": "OPEN",
    },
    {
        "id": "hosp-cardiac-center",
        "lat": 42.3520,
        "lng": -71.0750,
        "bed_count": 3,
        "specialties": ["general", "cardiac"],
        "status": "OPEN",
    },
    {
        "id": "hosp-trauma",
        "lat": 42.3800,
        "lng": -71.0300,
        "bed_count": 5,
        "specialties": ["general", "trauma", "cardiac"],
        "status": "OPEN",
    },
]
