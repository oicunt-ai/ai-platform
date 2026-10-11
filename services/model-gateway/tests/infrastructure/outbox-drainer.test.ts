/**
 * Regression tests for the metering outbox drainer.
 *
 * The store and the delivery transport are both faked: the sender records
 * every event it receives (or throws on demand), so replay identity,
 * backoff scheduling, quarantine, and crash recovery are proven without
 * any broker or database.
 */
import { describe, expect, it } from 'vitest';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import { PostgresMeteringOutboxStore } from '../../src/infrastructure/usage/outbox/outbox-store.js';
import { UsageUnroutableError } from '../../src/infrastructure/usage/publish-errors.js';
import {
  OutboxDrainer,
  type OutboxSenderPort,
} from '../../src/infrastructure/usage/outbox/outbox-drainer.js';

interface MemoryRow {
  outboxId: number;
  event: UsageEvent;
  status: 'pending' | 'sending' | 'failed';
  attempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  capturedAt: string;
}

/** Minimal in-memory store double with real claim/replay semantics. */
class MemoryOutbox {
  public rows: MemoryRow[] = [];
  public confirmed: number[] = [];
  public failed: number[] = [];
  private nextId = 1;

  seed(event: UsageEvent, overrides?: Partial<MemoryRow>): number {
    const id = this.nextId++;
    this.rows.push({
      outboxId: id,
      event,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(0).toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      capturedAt: new Date().toISOString(),
      ...overrides,
    });
    return id;
  }

  /** Transitions below are fenced by lease ownership, like the real SQL. */
  private owns(row: MemoryRow | undefined, leaseOwner: string): row is MemoryRow {
    return row !== undefined && row.status === 'sending' && row.leaseOwner === leaseOwner;
  }

  asStore(): PostgresMeteringOutboxStore {
    return {
      claimDueBatch: async (args: {
        limit: number;
        leaseOwner: string;
        leaseMs: number;
        nowIso: string;
        leaseExpiresAtIso: string;
      }) => {
        const due = this.rows
          .filter((r) => r.status === 'pending' && r.nextAttemptAt <= args.nowIso)
          .sort((a, b) => a.outboxId - b.outboxId)
          .slice(0, args.limit);
        for (const row of due) {
          row.status = 'sending';
          row.leaseOwner = args.leaseOwner;
          row.leaseExpiresAt = args.leaseExpiresAtIso;
          row.attempts += 1;
          row.lastError = null;
        }
        return due.map((r) => ({
          outboxId: r.outboxId,
          eventId: r.event.eventId,
          tenantId: r.event.tenantId,
          idempotencyKey: r.event.idempotencyKey,
          event: r.event,
          attempts: r.attempts,
          capturedAt: r.capturedAt,
        }));
      },
      markConfirmed: async (outboxId: number, leaseOwner: string) => {
        const row = this.rows.find((r) => r.outboxId === outboxId);
        if (!this.owns(row, leaseOwner)) return false;
        this.confirmed.push(outboxId);
        this.rows = this.rows.filter((r) => r.outboxId !== outboxId);
        return true;
      },
      markAttemptFailed: async (
        outboxId: number,
        nextAttemptAtIso: string,
        lastError: unknown,
        leaseOwner: string,
      ) => {
        const row = this.rows.find((r) => r.outboxId === outboxId);
        if (!this.owns(row, leaseOwner)) return false;
        row.status = 'pending';
        row.leaseOwner = null;
        row.leaseExpiresAt = null;
        row.nextAttemptAt = nextAttemptAtIso;
        row.lastError = lastError instanceof Error ? lastError.message : String(lastError);
        return true;
      },
      markFailed: async (outboxId: number, lastError: unknown, leaseOwner: string) => {
        const row = this.rows.find((r) => r.outboxId === outboxId);
        if (!this.owns(row, leaseOwner)) return false;
        row.status = 'failed';
        row.leaseOwner = null;
        row.leaseExpiresAt = null;
        row.lastError = lastError instanceof Error ? lastError.message : String(lastError);
        this.failed.push(outboxId);
        return true;
      },
      recoverExpiredLeases: async (nowIso: string) => {
        let recovered = 0;
        for (const row of this.rows) {
          if (row.status === 'sending' && (row.leaseExpiresAt ?? '') < nowIso) {
            row.status = 'pending';
            row.leaseOwner = null;
            row.leaseExpiresAt = null;
            row.nextAttemptAt = nowIso;
            recovered += 1;
          }
        }
        return recovered;
      },
      getStats: async () => {
        const pendingRows = this.rows.filter((r) => r.status === 'pending');
        return {
          pending: pendingRows.length,
          sending: this.rows.filter((r) => r.status === 'sending').length,
          failed: this.rows.filter((r) => r.status === 'failed').length,
          oldestPendingCapturedAt: pendingRows.map((r) => r.capturedAt).sort()[0] ?? null,
        };
      },
    } as unknown as PostgresMeteringOutboxStore;
  }
}

function testEvent(key: string): UsageEvent {
  return {
    eventId: `usage_test-${key}`,
    schemaVersion: '1.0.0',
    tenantId: 'tnt_test',
    productId: 'billy',
    sourceService: 'model-gateway',
    operation: 'model.completion',
    resourceId: 'oicunt.model.test',
    measurements: { 'tokens.input': 1, 'tokens.output': 2, 'tokens.total': 3, 'units.requests': 1 },
    dimensions: { provider: 'test-provider', usageSource: 'provider' },
    lineage: { correlationId: `corr-${key}`, requestId: `req-${key}` },
    idempotencyKey: `model.completion:test-${key}`,
    occurredAt: new Date().toISOString(),
  };
}

function recordingSender(behavior?: { failTimes?: number }): OutboxSenderPort & {
  sent: UsageEvent[];
} {
  const sent: UsageEvent[] = [];
  let failuresLeft = behavior?.failTimes ?? 0;
  return {
    sent,
    async send(event: UsageEvent) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('broker unavailable');
      }
      sent.push(event);
    },
  };
}

const NO_SLEEP = async (_ms: number) => {};

describe('OutboxDrainer', () => {
  it('delivers pending rows and deletes only confirmed records', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    memory.seed(testEvent('b'));
    const sender = recordingSender();
    let published = 0;
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender,
      options: { batchSize: 10, concurrency: 2 },
      metrics: { onPublished: () => (published += 1) },
      sleep: NO_SLEEP,
    });

    await drainer.drainOnce(new Date());

    expect(sender.sent.map((e) => e.eventId).sort()).toEqual(['usage_test-a', 'usage_test-b']);
    expect(published).toBe(2);
    expect(memory.rows).toHaveLength(0);
    expect(memory.confirmed).toHaveLength(2);
  });

  it('retries with growing backoff and preserves event identity across attempts', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    const sender = recordingSender({ failTimes: 2 });
    let retries = 0;
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender,
      options: { batchSize: 10, baseRetryDelayMs: 1000, maxRetryDelayMs: 60000 },
      metrics: { onRetryScheduled: () => (retries += 1) },
      sleep: NO_SLEEP,
    });
    const t0 = new Date('2026-01-01T00:00:00Z');

    await drainer.drainOnce(t0);
    expect(sender.sent).toHaveLength(0);
    expect(retries).toBe(1);
    // First retry scheduled 1s out (attempts=1 -> base * 2^0).
    expect(memory.rows[0]?.nextAttemptAt).toBe('2026-01-01T00:00:01.000Z');

    await drainer.drainOnce(new Date('2026-01-01T00:00:01.000Z'));
    expect(retries).toBe(2);
    // Second retry scheduled 2s out (attempts=2 -> base * 2^1).
    expect(memory.rows[0]?.nextAttemptAt).toBe('2026-01-01T00:00:03.000Z');

    await drainer.drainOnce(new Date('2026-01-01T00:00:03.000Z'));
    // Third delivery succeeds with the identical event identity.
    expect(sender.sent.map((e) => e.eventId)).toEqual(['usage_test-a']);
    expect(sender.sent[0]?.idempotencyKey).toBe('model.completion:test-a');
    expect(memory.rows).toHaveLength(0);
  });

  it('quarantines exhausted records without deleting them', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    const sender = recordingSender({ failTimes: 100 });
    let quarantined = 0;
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender,
      options: { batchSize: 10, maxAttempts: 2 },
      metrics: { onQuarantined: () => (quarantined += 1) },
      sleep: NO_SLEEP,
    });

    await drainer.drainOnce(new Date('2026-01-01T00:00:00Z'));
    await drainer.drainOnce(new Date('2026-01-01T00:10:00Z'));
    // Attempts exhausted on the third delivery: quarantined, never deleted.
    await drainer.drainOnce(new Date('2026-01-01T00:20:00Z'));

    expect(quarantined).toBe(1);
    expect(memory.failed).toHaveLength(1);
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0]?.status).toBe('failed');
    expect(memory.rows[0]?.event.eventId).toBe('usage_test-a');
    expect(sender.sent).toHaveLength(0);
  });

  it('recovers expired leases from dead workers before claiming', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'), {
      status: 'sending',
      attempts: 1,
      leaseExpiresAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    });
    const sender = recordingSender();
    let recovered = 0;
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender,
      metrics: { onLeasesRecovered: (count) => (recovered = count) },
      sleep: NO_SLEEP,
    });

    await drainer.drainOnce(new Date('2026-01-01T01:00:00Z'));

    expect(recovered).toBe(1);
    // The orphaned record was recovered and delivered with original identity.
    expect(sender.sent.map((e) => e.eventId)).toEqual(['usage_test-a']);
    expect(memory.rows).toHaveLength(0);
  });

  it('reports backlog stats for monitoring every cycle', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    const sender = recordingSender({ failTimes: 100 });
    let pending = -1;
    let oldestAge: number | null | undefined;
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender,
      metrics: {
        setPending: (count) => (pending = count),
        setOldestPendingAgeSec: (seconds) => (oldestAge = seconds),
      },
      sleep: NO_SLEEP,
    });

    // Captured 90 seconds before the cycle reference time.
    memory.rows[0]!.capturedAt = new Date('2026-01-01T00:00:00Z').toISOString();
    await drainer.drainOnce(new Date('2026-01-01T00:01:30Z'));

    expect(pending).toBe(1);
    expect(oldestAge).toBe(90);
  });

  it('survives a cycle failure and keeps draining afterwards', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    const sender = recordingSender();
    let calls = 0;
    const flakyStore = memory.asStore();
    const originalStats = flakyStore.getStats.bind(flakyStore);
    flakyStore.getStats = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('stats query down');
      }
      return originalStats();
    };
    const drainer = new OutboxDrainer({
      store: flakyStore,
      sender,
      sleep: NO_SLEEP,
    });

    await expect(drainer.drainOnce(new Date())).rejects.toThrow('stats query down');
    await drainer.drainOnce(new Date());
    expect(sender.sent).toHaveLength(1);
  });

  it('stops its background loop on demand', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    const sender = recordingSender();
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender,
      options: { pollIntervalMs: 5 },
      sleep: NO_SLEEP,
    });
    const run = drainer.start();
    // Let at least one cycle execute, then stop.
    await drainer.stop();
    await run;
    expect(drainer.isRunning()).toBe(false);
    expect(sender.sent.map((e) => e.eventId)).toEqual(['usage_test-a']);
  });

  it('quarantines unroutable events immediately without burning retries', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    let quarantined = 0;
    let retries = 0;
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender: {
        async send(event: UsageEvent) {
          throw new UsageUnroutableError(event.eventId, 'NO_ROUTE');
        },
      },
      options: { batchSize: 10, maxAttempts: 20 },
      metrics: {
        onQuarantined: () => (quarantined += 1),
        onRetryScheduled: () => (retries += 1),
      },
      sleep: NO_SLEEP,
    });

    await drainer.drainOnce(new Date());

    expect(quarantined).toBe(1);
    expect(retries).toBe(0);
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0]?.status).toBe('failed');
    expect(memory.rows[0]?.attempts).toBe(1);
    expect(memory.rows[0]?.event.eventId).toBe('usage_test-a');
  });

  it('does not confirm or count rows whose lease lapsed mid-delivery', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    let published = 0;
    const warnings: string[] = [];
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender: {
        async send(event: UsageEvent) {
          // Simulate a competing worker reclaiming the row mid-delivery:
          // the lease now belongs to someone else.
          const row = memory.rows.find((r) => r.event.eventId === event.eventId);
          if (row) {
            row.leaseOwner = 'competitor';
          }
        },
      },
      options: { batchSize: 10, ownerId: 'drainer-1' },
      metrics: { onPublished: () => (published += 1) },
      logger: { warn: (message) => warnings.push(message) },
      sleep: NO_SLEEP,
    });

    await drainer.drainOnce(new Date());

    // No confirm, no published metric, row retained for its rightful owner.
    expect(published).toBe(0);
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0]?.status).toBe('sending');
    expect(memory.rows[0]?.leaseOwner).toBe('competitor');
    expect(warnings.join(' ')).toContain('lease');
  });

  it('waits for in-flight deliveries on shutdown (bounded)', async () => {
    const memory = new MemoryOutbox();
    memory.seed(testEvent('a'));
    let notifySendStarted!: () => void;
    const sendStarted = new Promise<void>((resolve) => {
      notifySendStarted = resolve;
    });
    let releaseSend!: () => void;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const sender = {
      async send(_event: UsageEvent) {
        notifySendStarted();
        await sendGate;
      },
    };
    const drainer = new OutboxDrainer({
      store: memory.asStore(),
      sender,
      options: { pollIntervalMs: 5 },
      sleep: NO_SLEEP,
    });
    const run = drainer.start();
    await sendStarted;
    const stopping = drainer.stop();
    // Shutdown waits instead of abandoning the in-flight delivery.
    releaseSend();
    await stopping;
    await run;
    expect(drainer.isRunning()).toBe(false);
    expect(memory.rows).toHaveLength(0);
  });
});
