-- 001_metering_outbox: durable metering outbox owned by Model Gateway.
--
-- Holds provider usage events captured BEFORE the gateway reports provider
-- success, so metering survives process crashes, deployments, container
-- replacement, node loss, and RabbitMQ outages. A background drainer (P2
-- delivery) republishes pending rows to RabbitMQ with the STABLE eventId
-- and idempotencyKey recorded here; Platform Usage deduplicates replays via
-- its UNIQUE (tenant_id, idempotency_key) constraint, so replays can never
-- double-count.
--
-- Row lifecycle: pending -> sending (leased by exactly one drainer worker
-- via SELECT ... FOR UPDATE SKIP LOCKED) -> deleted on broker confirm.
-- Exhausted or unroutable rows move to failed (quarantine): they are NEVER
-- deleted by the drainer and remain operator-visible until a separately
-- approved retention policy removes them. Operators replay a quarantined
-- row by resetting it to pending; identity columns are never rewritten.

CREATE SCHEMA IF NOT EXISTS model_gateway_outbox;

CREATE TABLE IF NOT EXISTS model_gateway_outbox.metering_outbox (
  outbox_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  event JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  CONSTRAINT uq_metering_outbox_event UNIQUE (event_id),
  CONSTRAINT uq_metering_outbox_idempotency UNIQUE (tenant_id, idempotency_key)
);

-- Drainer due-scan: only pending rows whose backoff has elapsed.
CREATE INDEX IF NOT EXISTS ix_metering_outbox_due
  ON model_gateway_outbox.metering_outbox (next_attempt_at)
  WHERE status = 'pending';

-- Crash recovery scan: sending rows whose lease expired.
CREATE INDEX IF NOT EXISTS ix_metering_outbox_lease
  ON model_gateway_outbox.metering_outbox (lease_expires_at)
  WHERE status = 'sending';

-- Operator visibility: quarantined rows newest first.
CREATE INDEX IF NOT EXISTS ix_metering_outbox_failed
  ON model_gateway_outbox.metering_outbox (captured_at DESC)
  WHERE status = 'failed';
