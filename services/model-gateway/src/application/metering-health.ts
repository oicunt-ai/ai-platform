/**
 * Metering readiness evaluation for Model Gateway `/readyz`.
 *
 * Four signals are kept strictly separate:
 * - AI inference availability (adapters up, HTTP serving).
 * - Durable capture availability (outbox PostgreSQL reachable and schema
 *   verified). A required but unavailable capture store fails closed: the
 *   service reports not-ready so it stops receiving traffic instead of
 *   serving completions it cannot account for.
 * - RabbitMQ publisher connectivity (informational only).
 * - Outbox delivery backlog and quarantine depth (informational only).
 *
 * A RabbitMQ outage must NOT mark inference unhealthy while durable
 * capture is functional: captured events wait safely in PostgreSQL and
 * drain when connectivity returns.
 */

export interface MeteringBacklog {
  /** Rows awaiting delivery. */
  readonly pending: number;
  /** Age in seconds of the oldest pending row, or null when none. */
  readonly oldestPendingAgeSec: number | null;
  /** Quarantined rows awaiting operator inspection/replay. */
  readonly failed: number;
}

export interface MeteringHealthInput {
  /** AI inference serving (adapters registered, HTTP listening). */
  readonly inferenceReady: boolean;
  /** Metering explicitly enabled via configuration. */
  readonly meteringEnabled: boolean;
  /** Last-known durable capture reachability (pool ping / schema check). */
  readonly captureHealthy: boolean;
  /** Live publisher connectivity (confirm channel open, unblocked). */
  readonly publisherReady: boolean;
  readonly backlog: MeteringBacklog;
  /** Pending rows above this count degrade the backlog check. */
  readonly backlogWarnPending?: number | undefined;
  /** Oldest pending age above this (seconds) degrades the backlog check. */
  readonly backlogWarnAgeSec?: number | undefined;
}

export interface MeteringHealth {
  /** Overall readiness: inference AND (when enabled) capture. */
  readonly ready: boolean;
  readonly checks: Record<'capture' | 'publisher' | 'backlog', 'ok' | 'failed'>;
}

const DEFAULT_BACKLOG_WARN_PENDING = 1000;
const DEFAULT_BACKLOG_WARN_AGE_SEC = 900;

/**
 * Pure evaluation so the policy is unit-testable without services.
 * No I/O, no secrets: inputs are counts and booleans only.
 */
export function evaluateMeteringHealth(input: MeteringHealthInput): MeteringHealth {
  if (!input.meteringEnabled) {
    return {
      ready: input.inferenceReady,
      checks: { capture: 'ok', publisher: 'ok', backlog: 'ok' },
    };
  }
  const backlogWarnPending = input.backlogWarnPending ?? DEFAULT_BACKLOG_WARN_PENDING;
  const backlogWarnAgeSec = input.backlogWarnAgeSec ?? DEFAULT_BACKLOG_WARN_AGE_SEC;
  const capture: 'ok' | 'failed' = input.captureHealthy ? 'ok' : 'failed';
  const publisher: 'ok' | 'failed' = input.publisherReady ? 'ok' : 'failed';
  const backlog: 'ok' | 'failed' =
    input.backlog.failed > 0 ||
    input.backlog.pending > backlogWarnPending ||
    (input.backlog.oldestPendingAgeSec !== null &&
      input.backlog.oldestPendingAgeSec > backlogWarnAgeSec)
      ? 'failed'
      : 'ok';
  return {
    // Publisher and backlog never gate inference: only a dead capture does.
    ready: input.inferenceReady && input.captureHealthy,
    checks: { capture, publisher, backlog },
  };
}
