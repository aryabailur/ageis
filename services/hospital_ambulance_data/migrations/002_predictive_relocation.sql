-- Advisory demand inputs for predictive ambulance relocation.
-- Apply after 001_schema.sql, then re-run seed.py.

create table if not exists demand_zones (
    id text primary key,
    name text not null,
    lat double precision not null check (lat between -90 and 90),
    lng double precision not null check (lng between -180 and 180),
    historical_calls_7d integer not null default 0 check (historical_calls_7d >= 0)
);

alter table demand_zones enable row level security;

-- Backend services use the service-role key. Anonymous access remains
-- read-only, matching the existing ambulance and hospital reference data.
create policy "demand_zones_read_anon" on demand_zones for select using (true);
