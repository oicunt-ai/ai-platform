import type { UsageEvent } from '@oicunt-ai/usage-types';

/**
 * Durable metering capture for provider usage events (P1 outbox design).
 *
 * `capture` durably records the event BEFORE the caller reports provider
 * success to its own caller. A resolved promise means the event will
 * eventually reach accounting: it is stored in PostgreSQL and replayed
 * with a stable eventId/idempotencyKey until the broker confirms it.
 *
 * Any failure (database error, timeout, misconfiguration) rejects with
 * `MeteringCaptureUnavailableError` only — never with provider error
 * types — so callers can keep provider outcomes and metering outcomes
 * strictly separated.
 */
export interface MeteringCapturePort {
  capture(event: UsageEvent, options?: MeteringCaptureOptions | undefined): Promise<void>;
}

export interface MeteringCaptureOptions {
  /** Upper bound for the capture attempt. The store default applies when unset. */
  readonly timeoutMs?: number | undefined;
}
