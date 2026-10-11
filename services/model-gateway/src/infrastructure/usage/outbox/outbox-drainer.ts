import type { UsageEvent } from '@oicunt-ai/usage-types';
import type { OutboxRecord, PostgresMeteringOutboxStore } from './outbox-store.js';
import { UsageUnroutableError } from '../publish-errors.js';

/**
 * Delivery transport for drained outbox records.
 *
 * Contract: `send` resolves only after confirmed, routable publication.
 * It rejects with UsageUnroutableError when the broker positively refuses
 * to route the message (permanent: quarantine immediately, never retry),
 * and with any other error when delivery is uncertain (retryable with the
 * original event identity). The drainer never deletes a record it has not
 * successfully sent.
 */
export interface OutboxSenderPort {
  send(event: UsageEvent): Promise<void>;
}

export interface OutboxDrainerOptions {
  /** Rows claimed per cycle. Defaults to 50. */
  readonly batchSize?: number | undefined;
  /** Records processed concurrently within a cycle. Defaults to 5. */
  readonly concurrency?: number | undefined;
  /** Deliveries attempted per record before quarantine. Defaults to 20. */
  readonly maxAttempts?: number | undefined;
  /** First retry delay. Defaults to 1000ms; doubles per attempt. */
  readonly baseRetryDelayMs?: number | undefined;
  /** Upper bound for the retry delay. Defaults to 300000ms (5 minutes). */
  readonly maxRetryDelayMs?: number | undefined;
  /** Lease duration for claimed rows. Defaults to 300000ms (5 minutes). */
  readonly leaseMs?: number | undefined;
  /** Idle delay between cycles. Defaults to 1000ms. */
  readonly pollIntervalMs?: number | undefined;
  /** Upper bound for stop() to wait for in-flight deliveries. Defaults to 30000ms. */
  readonly stopTimeoutMs?: number | undefined;
  /** Stable identity of this drainer instance for lease fencing. */
  readonly ownerId?: string | undefined;
}

export interface OutboxDrainerMetrics {
  readonly onPublished?: (() => void) | undefined;
  readonly onRetryScheduled?: ((attempts: number) => void) | undefined;
  readonly onQuarantined?: (() => void) | undefined;
  readonly onLeasesRecovered?: ((count: number) => void) | undefined;
  readonly setPending?: ((count: number) => void) | undefined;
  readonly setOldestPendingAgeSec?: ((seconds: number | null) => void) | undefined;
}

export interface OutboxDrainerLogger {
  readonly info?: ((message: string, context?: Record<string, unknown>) => void) | undefined;
  readonly warn?: ((message: string, context?: Record<string, unknown>) => void) | undefined;
  readonly error?: ((message: string, context?: Record<string, unknown>) => void) | undefined;
}

export interface OutboxDrainerDependencies {
  readonly store: PostgresMeteringOutboxStore;
  readonly sender: OutboxSenderPort;
  readonly options?: OutboxDrainerOptions | undefined;
  readonly metrics?: OutboxDrainerMetrics | undefined;
  readonly logger?: OutboxDrainerLogger | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly now?: (() => Date) | undefined;
}

/**
 * Background drainer for the durable metering outbox.
 *
 * Each cycle: recover expired leases (crash recovery), report backlog
 * stats, claim due rows (atomic, multi-instance safe), and deliver them
 * with bounded concurrency. Confirmed records are deleted; exhausted or
 * poison records are quarantined to 'failed' where they stay
 * operator-visible — the drainer never deletes an unresolved record.
 *
 * Event identity is never rewritten: retries and replays always send the
 * exact event object captured at provider completion, so downstream
 * idempotent ingestion collapses every duplicate.
 */
export class OutboxDrainer {
  private readonly store: PostgresMeteringOutboxStore;
  private readonly sender: OutboxSenderPort;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly leaseMs: number;
  private readonly pollIntervalMs: number;
  private readonly stopTimeoutMs: number;
  private readonly ownerId: string;
  private readonly metrics: OutboxDrainerMetrics;
  private readonly logger: OutboxDrainerLogger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private running = false;
  private started = false;
  /** In-flight deliveries; stop() waits for these to settle (bounded). */
  private inFlight = 0;

  constructor(deps: OutboxDrainerDependencies) {
    this.store = deps.store;
    this.sender = deps.sender;
    this.batchSize = deps.options?.batchSize ?? 50;
    this.concurrency = Math.max(1, deps.options?.concurrency ?? 5);
    this.maxAttempts = deps.options?.maxAttempts ?? 20;
    this.baseRetryDelayMs = deps.options?.baseRetryDelayMs ?? 1000;
    this.maxRetryDelayMs = deps.options?.maxRetryDelayMs ?? 300000;
    this.leaseMs = deps.options?.leaseMs ?? 300000;
    this.pollIntervalMs = deps.options?.pollIntervalMs ?? 1000;
    this.stopTimeoutMs = deps.options?.stopTimeoutMs ?? 30000;
    this.ownerId =
      deps.options?.ownerId ?? `outbox-drainer-${process.pid}-${Date.now().toString(36)}`;
    this.metrics = deps.metrics ?? {};
    this.logger = deps.logger ?? {};
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now ?? (() => new Date());
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.running = true;
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (error) {
        // A cycle failure (e.g. stats query down) must not kill the drainer:
        // the next cycle retries. Cycle errors are observable, never silent.
        this.logger.error?.('Metering outbox drain cycle failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (this.running) {
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  public async stop(): Promise<void> {
    this.running = false;
    this.started = false;
    // Graceful shutdown: stop claiming new work, then let in-flight
    // deliveries settle (bounded) so a confirmed send is still followed by
    // its row deletion and a failed send still reschedules/quarantines.
    const deadline = Date.now() + this.stopTimeoutMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await this.sleep(50);
    }
    if (this.inFlight > 0) {
      this.logger.warn?.('Metering outbox drainer stopping with in-flight deliveries', {
        inFlight: this.inFlight,
      });
    }
  }

  /**
   * Single drain cycle. Exposed for tests and for supervised operation;
   * `start()` simply repeats it until `stop()`.
   */
  public async drainOnce(referenceTime?: Date | undefined): Promise<void> {
    const now = referenceTime ?? this.now();
    const nowIso = now.toISOString();

    const recovered = await this.store.recoverExpiredLeases(nowIso);
    if (recovered > 0) {
      this.metrics.onLeasesRecovered?.(recovered);
      this.logger.warn?.('Recovered metering outbox leases from dead workers', {
        count: recovered,
      });
    }

    const stats = await this.store.getStats();
    this.metrics.setPending?.(stats.pending);
    this.metrics.setOldestPendingAgeSec?.(
      stats.oldestPendingCapturedAt === null
        ? null
        : Math.max(
            0,
            Math.floor((now.getTime() - Date.parse(stats.oldestPendingCapturedAt)) / 1000),
          ),
    );

    if (stats.pending === 0) {
      return;
    }

    const records = await this.store.claimDueBatch({
      limit: this.batchSize,
      leaseOwner: this.ownerId,
      leaseMs: this.leaseMs,
      nowIso,
      leaseExpiresAtIso: new Date(now.getTime() + this.leaseMs).toISOString(),
    });

    for (let index = 0; index < records.length; index += this.concurrency) {
      const chunk = records.slice(index, index + this.concurrency);
      await Promise.all(chunk.map((record) => this.deliver(record, now)));
    }
  }

  private async deliver(record: OutboxRecord, now: Date): Promise<void> {
    this.inFlight += 1;
    try {
      try {
        await this.sender.send(record.event);
      } catch (error) {
        if (error instanceof UsageUnroutableError) {
          // Permanent: the broker cannot route this message. Quarantine
          // immediately instead of burning all retry attempts.
          const quarantined = await this.store.markFailed(record.outboxId, error, this.ownerId);
          if (quarantined) {
            this.metrics.onQuarantined?.();
            this.logger.error?.('Metering outbox record unroutable; quarantined', {
              outboxId: record.outboxId,
              eventId: record.eventId,
              attempts: record.attempts,
            });
          } else {
            this.logger.warn?.('Lost outbox lease before quarantine; row retained', {
              outboxId: record.outboxId,
              eventId: record.eventId,
            });
          }
          return;
        }
        if (record.attempts >= this.maxAttempts) {
          const quarantined = await this.store.markFailed(record.outboxId, error, this.ownerId);
          if (quarantined) {
            this.metrics.onQuarantined?.();
            this.logger.error?.('Metering outbox record exhausted retries; quarantined', {
              outboxId: record.outboxId,
              eventId: record.eventId,
              attempts: record.attempts,
            });
          } else {
            this.logger.warn?.('Lost outbox lease before quarantine; row retained', {
              outboxId: record.outboxId,
              eventId: record.eventId,
            });
          }
          return;
        }
        const delayMs = Math.min(
          this.maxRetryDelayMs,
          this.baseRetryDelayMs * Math.pow(2, Math.max(0, record.attempts - 1)),
        );
        const requeued = await this.store.markAttemptFailed(
          record.outboxId,
          new Date(now.getTime() + delayMs).toISOString(),
          error,
          this.ownerId,
        );
        if (requeued) {
          this.metrics.onRetryScheduled?.(record.attempts);
        } else {
          this.logger.warn?.('Lost outbox lease before requeue; row retained', {
            outboxId: record.outboxId,
            eventId: record.eventId,
          });
        }
        return;
      }
      const confirmed = await this.store.markConfirmed(record.outboxId, this.ownerId);
      if (confirmed) {
        this.metrics.onPublished?.();
      } else {
        // Our lease lapsed mid-delivery (row reclaimed by another worker or
        // recovered). The event may now be delivered twice — downstream
        // idempotent ingestion collapses the duplicate. Never count it as
        // our confirmation and never delete what we do not own.
        this.logger.warn?.('Lost outbox lease before confirm; possible duplicate delivery', {
          outboxId: record.outboxId,
          eventId: record.eventId,
        });
      }
    } finally {
      this.inFlight -= 1;
    }
  }
}
