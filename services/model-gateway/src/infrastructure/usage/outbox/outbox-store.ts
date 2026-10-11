import type { UsageEvent } from '@oicunt-ai/usage-types';
import { MeteringCaptureUnavailableError } from '../../../domain/errors.js';
import type {
  MeteringCaptureOptions,
  MeteringCapturePort,
} from '../../../application/ports/metering-capture.port.js';

/**
 * Minimal database surface the outbox store needs. `OutboxDatabasePool`
 * satisfies this structurally; tests substitute an in-memory fake so no
 * test ever contacts a live PostgreSQL server.
 */
export interface OutboxDbPort {
  query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{
    readonly rows: Array<Record<string, unknown>>;
    readonly rowCount: number | null;
  }>;
}

export interface OutboxRecord {
  readonly outboxId: number;
  readonly eventId: string;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly event: UsageEvent;
  /** Attempts including the current lease (incremented atomically at claim). */
  readonly attempts: number;
  readonly capturedAt: string;
}

export interface OutboxStats {
  readonly pending: number;
  readonly sending: number;
  readonly failed: number;
  /** ISO timestamp of the oldest pending row, or null when none is pending. */
  readonly oldestPendingCapturedAt: string | null;
}

const DEFAULT_CAPTURE_TIMEOUT_MS = 2000;
const MAX_ERROR_CHARS = 1000;

function truncateError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_ERROR_CHARS ? text.slice(0, MAX_ERROR_CHARS) : text;
}

/**
 * PostgreSQL-backed durable metering outbox.
 *
 * Capture is a single idempotent INSERT: the same (tenant_id,
 * idempotency_key) pair can be captured any number of times (process
 * restarts, retries, replays) and always resolves to the ORIGINAL row
 * identity — eventId and idempotencyKey are never rewritten, so downstream
 * deduplication collapses every replay.
 *
 * Claiming is a single UPDATE ... WHERE ... FOR UPDATE SKIP LOCKED
 * statement, so any number of drainer instances can share the table with
 * exactly-once claiming semantics. Leases expire; any instance recovers
 * rows left in 'sending' by crashed workers.
 *
 * Quarantined ('failed') rows are never deleted or reclaimed by this
 * class: they stay operator-visible until a separately approved retention
 * policy removes them.
 */
export class PostgresMeteringOutboxStore implements MeteringCapturePort {
  constructor(
    private readonly db: OutboxDbPort,
    private readonly defaultCaptureTimeoutMs: number = DEFAULT_CAPTURE_TIMEOUT_MS,
  ) {}

  public async capture(
    event: UsageEvent,
    options?: MeteringCaptureOptions | undefined,
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? this.defaultCaptureTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.insertEvent(event),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new MeteringCaptureUnavailableError('model-gateway', event.lineage.correlationId),
              ),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof MeteringCaptureUnavailableError) {
        // Timeout: the INSERT may still have committed server-side. That is
        // safe (the row is durable and replay is idempotent), but the caller
        // is told capture is unconfirmed so it fails closed honestly instead
        // of claiming success. Reconciliation joins on eventId downstream.
        throw error;
      }
      throw new MeteringCaptureUnavailableError('model-gateway', event.lineage.correlationId);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async insertEvent(event: UsageEvent): Promise<void> {
    let inserted;
    try {
      inserted = await this.db.query(
        `INSERT INTO model_gateway_outbox.metering_outbox
           (event_id, tenant_id, idempotency_key, event)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING outbox_id, captured_at`,
        [event.eventId, event.tenantId, event.idempotencyKey, JSON.stringify(event)],
      );
    } catch {
      throw new MeteringCaptureUnavailableError('model-gateway', event.lineage.correlationId);
    }
    if ((inserted.rowCount ?? 0) > 0) {
      return;
    }
    // Conflict: the original row already exists. Confirm it is still there
    // so capture resolves to durable state rather than assuming it.
    try {
      const existing = await this.db.query(
        `SELECT outbox_id FROM model_gateway_outbox.metering_outbox
          WHERE tenant_id = $1 AND idempotency_key = $2
          LIMIT 1`,
        [event.tenantId, event.idempotencyKey],
      );
      if ((existing.rowCount ?? 0) > 0) {
        return;
      }
    } catch {
      throw new MeteringCaptureUnavailableError('model-gateway', event.lineage.correlationId);
    }
    throw new MeteringCaptureUnavailableError('model-gateway', event.lineage.correlationId);
  }

  /**
   * Atomically claims up to `limit` due rows for this worker. The UPDATE and
   * the row selection (SKIP LOCKED) execute as one statement: concurrent
   * drainers never receive the same row.
   */
  public async claimDueBatch(args: {
    readonly limit: number;
    readonly leaseOwner: string;
    readonly leaseMs: number;
    readonly nowIso: string;
    readonly leaseExpiresAtIso: string;
  }): Promise<OutboxRecord[]> {
    const res = await this.db.query(
      `UPDATE model_gateway_outbox.metering_outbox
          SET status = 'sending',
              lease_owner = $1,
              lease_expires_at = $2,
              attempts = attempts + 1,
              last_error = NULL
        WHERE outbox_id IN (
          SELECT outbox_id
            FROM model_gateway_outbox.metering_outbox
           WHERE status = 'pending'
             AND next_attempt_at <= $3
           ORDER BY outbox_id
           LIMIT $4
           FOR UPDATE SKIP LOCKED
        )
      RETURNING outbox_id, event_id, tenant_id, idempotency_key, event, attempts, captured_at`,
      [args.leaseOwner, args.leaseExpiresAtIso, args.nowIso, args.limit],
    );
    return res.rows.map((row) => ({
      outboxId: Number(row['outbox_id']),
      eventId: String(row['event_id']),
      tenantId: String(row['tenant_id']),
      idempotencyKey: String(row['idempotency_key']),
      event:
        typeof row['event'] === 'string'
          ? (JSON.parse(row['event'] as string) as UsageEvent)
          : (row['event'] as UsageEvent),
      attempts: Number(row['attempts']),
      capturedAt:
        row['captured_at'] instanceof Date
          ? (row['captured_at'] as Date).toISOString()
          : String(row['captured_at']),
    }));
  }

  /**
   * Confirmed by the broker: the row has served its purpose and is removed.
   *
   * Fenced by lease ownership: only the worker holding the lease may
   * delete the row. A stale worker whose lease expired (row reclaimed by
   * another worker or recovered) gets `false` and must treat its delivery
   * as uncertain — never as confirmed. Returns true when the row was
   * deleted.
   */
  public async markConfirmed(outboxId: number, leaseOwner: string): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM model_gateway_outbox.metering_outbox
        WHERE outbox_id = $1 AND status = 'sending' AND lease_owner = $2`,
      [outboxId, leaseOwner],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Delivery failed but retryable: requeue with backoff, keeping identity.
   * Fenced by lease ownership like markConfirmed. Returns true when the
   * row was requeued.
   */
  public async markAttemptFailed(
    outboxId: number,
    nextAttemptAtIso: string,
    lastError: unknown,
    leaseOwner: string,
  ): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE model_gateway_outbox.metering_outbox
          SET status = 'pending',
              lease_owner = NULL,
              lease_expires_at = NULL,
              next_attempt_at = $2,
              last_error = $3
        WHERE outbox_id = $1 AND status = 'sending' AND lease_owner = $4`,
      [outboxId, nextAttemptAtIso, truncateError(lastError), leaseOwner],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Quarantine: the row stays operator-visible with its original identity.
   * Nothing in the drain path deletes or reclaims failed rows. Fenced by
   * lease ownership: a stale worker cannot quarantine a row it no longer
   * holds. Returns true when the row was quarantined.
   */
  public async markFailed(
    outboxId: number,
    lastError: unknown,
    leaseOwner: string,
  ): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE model_gateway_outbox.metering_outbox
          SET status = 'failed',
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error = $2
        WHERE outbox_id = $1 AND status = 'sending' AND lease_owner = $3`,
      [outboxId, truncateError(lastError), leaseOwner],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Crash recovery: rows left in 'sending' by dead workers (lease expired)
   * return to 'pending' with identity intact. Safe for every live instance
   * to run; the lease-expiry predicate fences ownership.
   */
  public async recoverExpiredLeases(nowIso: string): Promise<number> {
    const res = await this.db.query(
      `UPDATE model_gateway_outbox.metering_outbox
          SET status = 'pending',
              lease_owner = NULL,
              lease_expires_at = NULL,
              next_attempt_at = $1
        WHERE status = 'sending' AND lease_expires_at < $1`,
      [nowIso],
    );
    return res.rowCount ?? 0;
  }

  /**
   * Operator replay of a quarantined row: returns it to 'pending' with the
   * SAME eventId/idempotencyKey, so downstream deduplication still applies.
   */
  public async replayFailed(outboxId: number, nowIso: string): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE model_gateway_outbox.metering_outbox
          SET status = 'pending',
              attempts = 0,
              next_attempt_at = $2,
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_error = NULL
        WHERE outbox_id = $1 AND status = 'failed'`,
      [outboxId, nowIso],
    );
    return (res.rowCount ?? 0) > 0;
  }

  public async getStats(): Promise<OutboxStats> {
    const counts = await this.db.query(
      `SELECT status, COUNT(*) AS count
         FROM model_gateway_outbox.metering_outbox
        GROUP BY status`,
    );
    let pending = 0;
    let sending = 0;
    let failed = 0;
    for (const row of counts.rows) {
      const count = Number(row['count']);
      if (row['status'] === 'pending') pending = count;
      else if (row['status'] === 'sending') sending = count;
      else if (row['status'] === 'failed') failed = count;
    }
    const oldest = await this.db.query(
      `SELECT captured_at
         FROM model_gateway_outbox.metering_outbox
        WHERE status = 'pending'
        ORDER BY captured_at ASC
        LIMIT 1`,
    );
    const oldestRow = oldest.rows[0]?.['captured_at'];
    return {
      pending,
      sending,
      failed,
      oldestPendingCapturedAt:
        oldestRow === undefined || oldestRow === null
          ? null
          : oldestRow instanceof Date
            ? oldestRow.toISOString()
            : String(oldestRow),
    };
  }
}
