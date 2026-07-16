-- AEGIS hospital_ambulance_data schema.
-- Run this in the Supabase SQL editor (or via `supabase db push`) once,
-- against the project whose URL/service-role key the service is
-- configured with.

create table if not exists ambulances (
    id text primary key,
    lat double precision not null,
    lng double precision not null,
    capability text not null check (capability in ('BLS', 'ALS')),
    status text not null default 'AVAILABLE'
);

create table if not exists hospitals (
    id text primary key,
    lat double precision not null,
    lng double precision not null,
    bed_count integer not null default 0,
    specialties text[] not null default '{}',
    status text not null default 'OPEN' check (status in ('OPEN', 'DIVERSION'))
);

-- Backend services write here directly with the service-role key, so
-- there is no end-user-facing auth layer to enforce with RLS policies —
-- the "authorization boundary" for this system is "which process holds
-- the service-role key", same as reservations below.
create table if not exists reservations (
    reservation_id text primary key,
    call_id text not null unique,          -- idempotency_key
    ambulance_id text not null references ambulances(id),
    hospital_id text not null references hospitals(id),
    confirmed boolean not null default true,
    created_at timestamptz not null default now(),
    -- one ambulance can't be reserved on two different calls at once.
    unique (ambulance_id)
);

alter table ambulances enable row level security;
alter table hospitals enable row level security;
alter table reservations enable row level security;

-- Service-role key bypasses RLS entirely; these policies just make the
-- intent explicit and give you a safe default if you ever expose the
-- anon key to a client directly (read-only, no writes).
create policy "ambulances_read_anon" on ambulances for select using (true);
create policy "hospitals_read_anon" on hospitals for select using (true);
