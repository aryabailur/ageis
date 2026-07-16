"""Demo seed data and the demo patient location, used by seed.py to
populate Supabase and by tests to know what to expect. This is no longer
read at request time -- logic.py queries Supabase directly -- but it's
the single source of truth for what "the seeded state" is.

Coordinates are chosen so the naive nearest-to-nearest baseline is
visibly wrong: the geographically nearest ambulance to the demo patient
is BLS-only, and the nearest hospital lacks cardiac capability.

Centered on Bandra West, Mumbai (Thadomal Shahani Engineering College area)
for the in-person review.
"""

from __future__ import annotations

DEMO_PATIENT_LAT = 19.0596
DEMO_PATIENT_LNG = 72.8295

AMBULANCES: list[dict] = [
    {"id": "unit-4", "lat": 19.0605, "lng": 72.8290, "capability": "BLS", "status": "AVAILABLE"},
    {"id": "unit-7", "lat": 19.0520, "lng": 72.8200, "capability": "ALS", "status": "AVAILABLE"},
    {"id": "unit-2", "lat": 19.0700, "lng": 72.8400, "capability": "ALS", "status": "AVAILABLE"},
    {"id": "unit-9", "lat": 19.0420, "lng": 72.8150, "capability": "BLS", "status": "ON_CALL"},
    {"id": "unit-3", "lat": 19.0650, "lng": 72.8350, "capability": "ALS", "status": "AVAILABLE"},
    {"id": "unit-5", "lat": 19.0550, "lng": 72.8330, "capability": "ALS", "status": "AVAILABLE"},
]

HOSPITALS: list[dict] = [
    {
        "id": "hosp-general",
        "lat": 19.0610,
        "lng": 72.8280,
        "bed_count": 2,
        "specialties": ["general"],
        "status": "OPEN",
    },
    {
        "id": "hosp-cardiac-center",
        "lat": 19.0490,
        "lng": 72.8180,
        "bed_count": 3,
        "specialties": ["general", "cardiac"],
        "status": "OPEN",
    },
    {
        "id": "hosp-trauma",
        "lat": 19.0750,
        "lng": 72.8450,
        "bed_count": 5,
        "specialties": ["general", "trauma", "cardiac"],
        "status": "OPEN",
    },
]
