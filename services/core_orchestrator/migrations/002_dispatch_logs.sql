-- Migration 002: dispatch call log
--
-- Records every completed dispatch run (any terminal status including
-- AWAITING_REVIEW, DISPATCHED, COMPLETED, FAILED) so the dashboard
-- History tab can list, filter, and replay any past call.
--
-- state_snapshot is the authoritative record -- a full DispatchState
-- serialised as JSONB.  The scalar columns (status, priority, caller_lat,
-- caller_lng, completed_at) are redundant projections that allow cheap
-- server-side filtering without deserialising the snapshot per row.
--
-- Run against your Supabase project via the SQL editor or psql:
--   psql $DATABASE_URL -f migrations/002_dispatch_logs.sql

CREATE TABLE IF NOT EXISTS dispatch_logs (
    id              BIGSERIAL        PRIMARY KEY,
    call_id         TEXT             NOT NULL,
    status          TEXT             NOT NULL,  -- DispatchStatus enum value
    priority        TEXT,                       -- triage.priority, or NULL when triage was skipped
    caller_lat      DOUBLE PRECISION,
    caller_lng      DOUBLE PRECISION,
    completed_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
    state_snapshot  JSONB            NOT NULL   -- DispatchState.model_dump(mode="json")
);

-- call_id index: used by GET /api/logs/{call_id}
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_call_id
    ON dispatch_logs (call_id);

-- completed_at DESC: default sort for the list endpoint
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_completed_at
    ON dispatch_logs (completed_at DESC);

-- status: used by server-side status filter on GET /api/logs
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_status
    ON dispatch_logs (status);
