/**
 * Regression tests for the durable metering outbox store.
 *
 * All database behavior is faked in memory: no test contacts a live
 * PostgreSQL server. The fake implements the same single-statement
 * atomicity the real SQL provides (claim = one UPDATE ... FOR UPDATE
 * SKIP LOCKED), so concurrency and lease semantics are genuinely
 * exercised.
 */
import { describe, expect, it } from 'vitest';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import { MeteringCaptureUnavailableError } from '../../src/domain/errors.js';
import {
  PostgresMeteringOutboxStore,
  type OutboxDbPort,
} from '../../src/infrastructure/usage/outbox/outbox-store.js';

interface FakeRow {
  outboxId: number;
  eventId: string;
  tenantId: string;
  idempotencyKey: string;
  event: string;
  status: 'pending' | 'sending' | 'failed';
  attempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  capturedAt: string;
}

/** In-memory fake honoring the store's SQL contract statement-by-statement. */
class FakeOutboxDb implements OutboxDbPort {
  public rows: FakeRow[] = [];
  public statements: string[] = [];
  private nextId = 1;
  public failWith: Error | null = null;
  public neverResolve = false;

  async query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> {
    this.statements.push(text.split('\n')[0]?.trim() ?? text);
    if (this.failWith) {
      throw this.failWith;
    }
    if (this.neverResolve) {
      await new Promise<never>(() => {
        // Intentionally pending: exercises the capture timeout path.
      });
    }
    const p = params ?? [];
    const now = new Date().toISOString();

    if (text.includes('INSERT INTO model_gateway_outbox.metering_outbox')) {
      const [eventId, tenantId, idempotencyKey, eventJson] = p as [string, string, string, string];
      const duplicate = this.rows.some(
        (r) => r.tenantId === tenantId && r.idempotencyKey === idempotencyKey,
      );
      if (duplicate) {
        return { rows: [], rowCount: 0 };
      }
      const row: FakeRow = {
        outboxId: this.nextId++,
        eventId,
        tenantId,
        idempotencyKey,
        event: eventJson,
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        capturedAt: now,
      };
      this.rows.push(row);
      return {
        rows: [{ outbox_id: row.outboxId, captured_at: row.capturedAt }],
        rowCount: 1,
      };
    }

    if (text.includes('SELECT outbox_id FROM model_gateway_outbox.metering_outbox')) {
      const [tenantId, idempotencyKey] = p as [string, string];
      const found = this.rows.find(
        (r) => r.tenantId === tenantId && r.idempotencyKey === idempotencyKey,
      );
      return found
        ? { rows: [{ outbox_id: found.outboxId }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (text.includes("SET status = 'sending'")) {
      const [leaseOwner, leaseExpiresAt, nowIso, limit] = p as [string, string, string, number];
      const due = this.rows
        .filter((r) => r.status === 'pending' && r.nextAttemptAt <= nowIso)
        .sort((a, b) => a.outboxId - b.outboxId)
        .slice(0, limit);
      for (const row of due) {
        row.status = 'sending';
        row.leaseOwner = leaseOwner;
        row.leaseExpiresAt = leaseExpiresAt;
        row.attempts += 1;
        row.lastError = null;
      }
      return {
        rows: due.map((r) => ({
          outbox_id: r.outboxId,
          event_id: r.eventId,
          tenant_id: r.tenantId,
          idempotency_key: r.idempotencyKey,
          event: r.event,
          attempts: r.attempts,
          captured_at: r.capturedAt,
        })),
        rowCount: due.length,
      };
    }

    if (text.startsWith('DELETE FROM model_gateway_outbox.metering_outbox')) {
      const [outboxId, leaseOwner] = p as [number, string];
      const before = this.rows.length;
      this.rows = this.rows.filter(
        (r) => !(r.outboxId === outboxId && r.status === 'sending' && r.leaseOwner === leaseOwner),
      );
      return { rows: [], rowCount: before - this.rows.length };
    }

    if (
      text.includes("SET status = 'pending'") &&
      text.includes("status = 'sending' AND lease_expires_at")
    ) {
      const [nowIso] = p as [string];
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
      return { rows: [], rowCount: recovered };
    }

    if (text.includes("SET status = 'pending'") && text.includes('attempts = 0')) {
      const [outboxId, nowIso] = p as [number, string];
      const row = this.rows.find((r) => r.outboxId === outboxId && r.status === 'failed');
      if (row) {
        row.status = 'pending';
        row.attempts = 0;
        row.nextAttemptAt = nowIso;
        row.leaseOwner = null;
        row.leaseExpiresAt = null;
        row.lastError = null;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (text.includes("SET status = 'pending'") && text.includes('next_attempt_at = $2')) {
      const [outboxId, nextAttemptAt, lastError, leaseOwner] = p as [
        number,
        string,
        string,
        string,
      ];
      const row = this.rows.find(
        (r) => r.outboxId === outboxId && r.status === 'sending' && r.leaseOwner === leaseOwner,
      );
      if (row) {
        row.status = 'pending';
        row.leaseOwner = null;
        row.leaseExpiresAt = null;
        row.nextAttemptAt = nextAttemptAt;
        row.lastError = lastError;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (text.includes("SET status = 'failed'")) {
      const [outboxId, lastError, leaseOwner] = p as [number, string, string];
      const row = this.rows.find(
        (r) => r.outboxId === outboxId && r.status === 'sending' && r.leaseOwner === leaseOwner,
      );
      if (row) {
        row.status = 'failed';
        row.leaseOwner = null;
        row.leaseExpiresAt = null;
        row.lastError = lastError;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (text.includes('SELECT status, COUNT(*)')) {
      const counts = new Map<string, number>();
      for (const row of this.rows) {
        counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
      }
      return {
        rows: [...counts.entries()].map(([status, count]) => ({ status, count: String(count) })),
        rowCount: counts.size,
      };
    }

    if (text.includes('ORDER BY captured_at ASC')) {
      const oldest = this.rows
        .filter((r) => r.status === 'pending')
        .sort((a, b) => (a.capturedAt < b.capturedAt ? -1 : 1))[0];
      return oldest
        ? { rows: [{ captured_at: oldest.capturedAt }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    throw new Error(`FakeOutboxDb: unhandled statement: ${text.slice(0, 80)}`);
  }
}

function testEvent(idempotencyKey: string, overrides?: Partial<UsageEvent>): UsageEvent {
  return {
    eventId: `usage_test-${idempotencyKey}`,
    schemaVersion: '1.0.0',
    tenantId: 'tnt_test',
    userId: 'usr_test',
    actorId: 'api-gateway',
    productId: 'billy',
    sourceService: 'model-gateway',
    operation: 'model.completion',
    resourceId: 'oicunt.model.test',
    measurements: {
      'tokens.input': 5,
      'tokens.output': 7,
      'tokens.total': 12,
      'units.requests': 1,
    },
    dimensions: { provider: 'test-provider', usageSource: 'provider' },
    lineage: { correlationId: 'corr_test', requestId: 'req_test', sessionId: 'conv_test' },
    idempotencyKey: `model.completion:test-${idempotencyKey}`,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PostgresMeteringOutboxStore', () => {
  it('captures an event durably with stable identity', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.eventId).toBe('usage_test-a');
    expect(db.rows[0]?.status).toBe('pending');
    const stats = await store.getStats();
    expect(stats).toEqual({
      pending: 1,
      sending: 0,
      failed: 0,
      oldestPendingCapturedAt: db.rows[0]?.capturedAt,
    });
  });

  it('resolves duplicate captures to the original row without rewriting identity', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    // A replayed capture (same tenant + idempotency key, different eventId)
    // resolves to the original durable row.
    await store.capture(testEvent('a', { eventId: 'usage_test-a-retry' }));
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.eventId).toBe('usage_test-a');
  });

  it('fails closed with METERING_CAPTURE_UNAVAILABLE when the database errors', async () => {
    const db = new FakeOutboxDb();
    db.failWith = new Error('connection refused');
    const store = new PostgresMeteringOutboxStore(db);
    await expect(store.capture(testEvent('a'))).rejects.toBeInstanceOf(
      MeteringCaptureUnavailableError,
    );
    await expect(store.capture(testEvent('a'))).rejects.toMatchObject({
      code: 'METERING_CAPTURE_UNAVAILABLE',
    });
  });

  it('fails closed when capture exceeds its timeout', async () => {
    const db = new FakeOutboxDb();
    db.neverResolve = true;
    const store = new PostgresMeteringOutboxStore(db);
    await expect(store.capture(testEvent('a'), { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'METERING_CAPTURE_UNAVAILABLE',
    });
  });

  it('claims due rows atomically so concurrent drainers never share a row', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    for (const key of ['a', 'b', 'c']) {
      await store.capture(testEvent(key));
    }
    const now = new Date().toISOString();
    const first = await store.claimDueBatch({
      limit: 2,
      leaseOwner: 'worker-1',
      leaseMs: 60000,
      nowIso: now,
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    const second = await store.claimDueBatch({
      limit: 2,
      leaseOwner: 'worker-2',
      leaseMs: 60000,
      nowIso: now,
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    expect(first.map((r) => r.eventId).sort()).toEqual(['usage_test-a', 'usage_test-b']);
    expect(second.map((r) => r.eventId)).toEqual(['usage_test-c']);
    expect(first[0]?.attempts).toBe(1);
    expect(first[0]?.event.measurements['tokens.total']).toBe(12);
  });

  it('recovers expired leases from crashed workers with identity intact', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    const now = new Date().toISOString();
    const claimed = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'dead-worker',
      leaseMs: 1000,
      nowIso: now,
      leaseExpiresAtIso: new Date(Date.now() - 5000).toISOString(),
    });
    expect(claimed).toHaveLength(1);
    const recovered = await store.recoverExpiredLeases(new Date().toISOString());
    expect(recovered).toBe(1);
    const stats = await store.getStats();
    expect(stats.pending).toBe(1);
    expect(stats.sending).toBe(0);
    // The recovered row is claimable again with the same identity.
    const reclaimed = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'worker-2',
      leaseMs: 60000,
      nowIso: new Date().toISOString(),
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    expect(reclaimed.map((r) => r.eventId)).toEqual(['usage_test-a']);
  });

  it('does not recover unexpired leases', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'live-worker',
      leaseMs: 60000,
      nowIso: new Date().toISOString(),
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    expect(await store.recoverExpiredLeases(new Date().toISOString())).toBe(0);
  });

  it('preserves failed records: quarantine is terminal for the drainer', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    const now = new Date().toISOString();
    const [claimed] = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'worker-1',
      leaseMs: 60000,
      nowIso: now,
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    await store.markFailed(claimed!.outboxId, new Error('unroutable'), 'worker-1');
    const stats = await store.getStats();
    expect(stats.failed).toBe(1);
    // Failed rows are never claimed again ...
    expect(
      await store.claimDueBatch({
        limit: 10,
        leaseOwner: 'worker-2',
        leaseMs: 60000,
        nowIso: new Date().toISOString(),
        leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
      }),
    ).toHaveLength(0);
    // ... but operator replay restores them with identical identity.
    expect(await store.replayFailed(claimed!.outboxId, new Date().toISOString())).toBe(true);
    const replayed = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'worker-3',
      leaseMs: 60000,
      nowIso: new Date().toISOString(),
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    expect(replayed.map((r) => r.eventId)).toEqual(['usage_test-a']);
    expect(replayed[0]?.attempts).toBe(1);
  });

  it('marks retryable attempts pending with backoff scheduling intact', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    const [claimed] = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'worker-1',
      leaseMs: 60000,
      nowIso: new Date().toISOString(),
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    const nextAttempt = new Date(Date.now() + 2000).toISOString();
    await store.markAttemptFailed(
      claimed!.outboxId,
      nextAttempt,
      new Error('broker down'),
      'worker-1',
    );
    expect(db.rows[0]?.status).toBe('pending');
    expect(db.rows[0]?.nextAttemptAt).toBe(nextAttempt);
    expect(db.rows[0]?.lastError).toContain('broker down');
  });

  it('deletes only confirmed records', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    const [claimed] = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'worker-1',
      leaseMs: 60000,
      nowIso: new Date().toISOString(),
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    await store.markConfirmed(claimed!.outboxId, 'worker-1');
    expect(db.rows).toHaveLength(0);
    expect(await store.getStats()).toEqual({
      pending: 0,
      sending: 0,
      failed: 0,
      oldestPendingCapturedAt: null,
    });
  });

  it('refuses transitions from workers that do not hold the lease', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    const [claimed] = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'worker-1',
      leaseMs: 60000,
      nowIso: new Date().toISOString(),
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    const id = claimed!.outboxId;
    // A stale worker (expired lease, row reclaimed elsewhere — simulated by
    // a wrong owner) cannot confirm, requeue, or quarantine the row.
    expect(await store.markConfirmed(id, 'stale-worker')).toBe(false);
    expect(
      await store.markAttemptFailed(id, new Date().toISOString(), new Error('x'), 'stale-worker'),
    ).toBe(false);
    expect(await store.markFailed(id, new Error('x'), 'stale-worker')).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.status).toBe('sending');
    expect(db.rows[0]?.leaseOwner).toBe('worker-1');
    // The rightful lease holder still transitions normally.
    expect(await store.markConfirmed(id, 'worker-1')).toBe(true);
    expect(db.rows).toHaveLength(0);
  });

  it('never deletes a quarantined row through a stale confirm', async () => {
    const db = new FakeOutboxDb();
    const store = new PostgresMeteringOutboxStore(db);
    await store.capture(testEvent('a'));
    const [claimed] = await store.claimDueBatch({
      limit: 10,
      leaseOwner: 'worker-1',
      leaseMs: 60000,
      nowIso: new Date().toISOString(),
      leaseExpiresAtIso: new Date(Date.now() + 60000).toISOString(),
    });
    const id = claimed!.outboxId;
    expect(await store.markFailed(id, new Error('unroutable'), 'worker-1')).toBe(true);
    // A late confirm from any worker must not remove the quarantined row.
    expect(await store.markConfirmed(id, 'worker-1')).toBe(false);
    expect(await store.markConfirmed(id, 'stale-worker')).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.status).toBe('failed');
  });
});
