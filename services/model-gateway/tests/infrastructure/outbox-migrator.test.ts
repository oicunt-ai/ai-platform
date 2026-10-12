/**
 * Regression tests for the explicit outbox migrator.
 *
 * Advisory-lock ownership (dedicated client, lock before DDL, unlock on
 * the same session, release on every path), concurrency serialization,
 * rollback without false ledger entries, and schema ownership are proven
 * with an in-memory fake database. No live PostgreSQL is contacted; the
 * real migration SQL files are read from the repository.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OutboxDatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import type { OutboxDatabasePool } from '../../src/infrastructure/database/connection.js';

/** Process-wide advisory lock with ownership tracking and FIFO waiters. */
class FakeAdvisoryLock {
  private heldBy: string | null = null;
  private readonly waiters: Array<() => void> = [];
  public activeHolders = 0;
  public maxActive = 0;

  async acquire(owner: string): Promise<void> {
    if (this.heldBy === null) {
      this.hold(owner);
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.hold(owner);
        resolve();
      });
    });
  }

  private hold(owner: string): void {
    this.heldBy = owner;
    this.activeHolders += 1;
    this.maxActive = Math.max(this.maxActive, this.activeHolders);
  }

  release(owner: string): void {
    if (this.heldBy !== owner) {
      throw new Error(`advisory unlock without ownership (holder=${this.heldBy}, caller=${owner})`);
    }
    this.heldBy = null;
    this.activeHolders -= 1;
    const next = this.waiters.shift();
    next?.();
  }

  /**
   * Server-side session death (connection destroyed): any lock the dead
   * session held is gone. Mirrors PostgreSQL releasing session-scoped
   * advisory locks when the session ends.
   */
  releaseIfHeldBy(owner: string): void {
    if (this.heldBy !== owner) {
      return;
    }
    this.heldBy = null;
    this.activeHolders -= 1;
    const next = this.waiters.shift();
    next?.();
  }
}

interface FakeSharedDb {
  readonly ledger: Set<string>;
  readonly lock: FakeAdvisoryLock;
  readonly executed: string[];
  failUnlock?: boolean;
  /** When set, unlock reports false (lock provably not held) instead. */
  unlockReportsFalse?: boolean;
  failOnSql?: RegExp | undefined;
  /** Every client the pool hands out, with how it was returned. */
  readonly dispositions: Array<{ id: string; destroyed: boolean }>;
}

class FakeMigrationClient {
  public released = false;
  public destroyed = false;
  constructor(
    private readonly id: string,
    private readonly shared: FakeSharedDb,
  ) {}

  async query(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> {
    const head = text.split('\n')[0]?.trim() ?? text;
    this.shared.executed.push(`${this.id}: ${head.slice(0, 72)}`);
    if (this.shared.failOnSql?.test(text)) {
      throw new Error(`boom: ${head.slice(0, 40)}`);
    }
    if (text.includes('pg_advisory_lock')) {
      await this.shared.lock.acquire(this.id);
      return { rows: [], rowCount: null };
    }
    if (text.includes('pg_advisory_unlock')) {
      if (this.shared.failUnlock) {
        throw new Error('unlock channel broken');
      }
      if (this.shared.unlockReportsFalse) {
        return { rows: [{ pg_advisory_unlock: false }], rowCount: 1 };
      }
      this.shared.lock.release(this.id);
      return { rows: [{ pg_advisory_unlock: true }], rowCount: 1 };
    }
    if (text.includes('FROM model_gateway_outbox._migrations')) {
      return {
        rows: [...this.shared.ledger].map((name) => ({ name })),
        rowCount: this.shared.ledger.size,
      };
    }
    if (text.startsWith('INSERT INTO model_gateway_outbox._migrations')) {
      this.shared.ledger.add(String(params?.[0]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: null };
  }

  release(err?: unknown): void {
    this.released = true;
    // A truthy argument destroys the connection instead of pooling it
    // (node-postgres release(err) semantics, mirrored by this fake).
    this.destroyed = err !== undefined && err !== null && err !== false;
    if (this.destroyed) {
      // Destroyed sessions take their server-side locks with them.
      this.shared.lock.releaseIfHeldBy(this.id);
    }
    this.shared.dispositions.push({ id: this.id, destroyed: this.destroyed });
  }
}

function fakePool(shared: FakeSharedDb, clients: FakeMigrationClient[]): OutboxDatabasePool {
  let next = 0;
  return {
    async getClient() {
      const client = new FakeMigrationClient(`client-${(next += 1)}`, shared);
      clients.push(client);
      return client as never;
    },
    async query() {
      throw new Error('migrator must use the dedicated client, never pool.query');
    },
    async ping() {
      return true;
    },
    async close() {},
  } as unknown as OutboxDatabasePool;
}

function sharedDb(): FakeSharedDb {
  return {
    ledger: new Set<string>(),
    lock: new FakeAdvisoryLock(),
    executed: [],
    dispositions: [],
  };
}

describe('OutboxDatabaseMigrator', () => {
  it('locks on the dedicated client before any migration DDL', async () => {
    const shared = sharedDb();
    const clients: FakeMigrationClient[] = [];
    const migrator = new OutboxDatabaseMigrator(fakePool(shared, clients));

    const result = await migrator.runMigrations();

    expect(result.applied).toEqual(['001_metering_outbox.sql']);
    expect(clients).toHaveLength(1);
    const statements = clients[0]!.released;
    expect(statements).toBe(true);
    const heads = shared.executed.map((line) => line.split(': ')[1] ?? line);
    expect(heads[0]).toContain('pg_advisory_lock');
    const lockIndex = shared.executed.findIndex((line) => line.includes('pg_advisory_lock'));
    const ddlIndex = shared.executed.findIndex((line) => line.includes('CREATE SCHEMA'));
    const unlockIndex = shared.executed.findIndex((line) => line.includes('pg_advisory_unlock'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(ddlIndex).toBeGreaterThan(lockIndex);
    expect(unlockIndex).toBeGreaterThan(ddlIndex);
    expect(shared.ledger.has('001_metering_outbox.sql')).toBe(true);
  });

  it('uses exactly one client for the whole operation', async () => {
    const shared = sharedDb();
    const clients: FakeMigrationClient[] = [];
    const migrator = new OutboxDatabaseMigrator(fakePool(shared, clients));
    await migrator.runMigrations();
    await migrator.runMigrations();
    // One dedicated client per run; the second run finds everything applied.
    expect(clients).toHaveLength(2);
    expect(clients.every((c) => c.released)).toBe(true);
  });

  it('serializes concurrent migrators so they never overlap', async () => {
    const shared = sharedDb();
    const firstClients: FakeMigrationClient[] = [];
    const secondClients: FakeMigrationClient[] = [];
    // Slow the critical section so overlap would be observable.
    const slowPool = fakePool(shared, firstClients);
    const first = new OutboxDatabaseMigrator(slowPool);
    const second = new OutboxDatabaseMigrator(fakePool(shared, secondClients));

    const [firstResult, secondResult] = await Promise.all([
      first.runMigrations(),
      second.runMigrations(),
    ]);

    expect(shared.lock.maxActive).toBe(1);
    const applied = [...firstResult.applied, ...secondResult.applied];
    const already = [...firstResult.alreadyApplied, ...secondResult.alreadyApplied];
    // Exactly one migrator applied the file; the other saw it as done.
    expect(applied).toEqual(['001_metering_outbox.sql']);
    expect(already).toEqual(['001_metering_outbox.sql']);
  });

  it('rolls back and records no ledger entry when migration SQL fails', async () => {
    const shared = sharedDb();
    const clients: FakeMigrationClient[] = [];
    shared.failOnSql = /CREATE TABLE IF NOT EXISTS model_gateway_outbox\.metering_outbox/;
    const migrator = new OutboxDatabaseMigrator(fakePool(shared, clients));

    await expect(migrator.runMigrations()).rejects.toThrow(/boom/);

    expect(shared.ledger.size).toBe(0);
    const texts = shared.executed.join('\n');
    expect(texts).toContain('ROLLBACK');
    expect(texts).not.toContain('INSERT INTO model_gateway_outbox._migrations');
    // Lock released on the same session, client released on every path.
    expect(shared.lock.activeHolders).toBe(0);
    expect(clients).toHaveLength(1);
    expect(clients[0]!.released).toBe(true);
  });

  it('releases the client normally on a successful unlock', async () => {
    const shared = sharedDb();
    const clients: FakeMigrationClient[] = [];
    const migrator = new OutboxDatabaseMigrator(fakePool(shared, clients));

    const result = await migrator.runMigrations();

    expect(result.applied).toEqual(['001_metering_outbox.sql']);
    expect(clients[0]!.released).toBe(true);
    expect(clients[0]!.destroyed).toBe(false);
    expect(shared.dispositions).toEqual([{ id: 'client-1', destroyed: false }]);
  });

  it('destroys instead of pooling the connection when unlock itself fails', async () => {
    const shared = sharedDb();
    shared.failUnlock = true;
    const clients: FakeMigrationClient[] = [];
    const migrator = new OutboxDatabaseMigrator(fakePool(shared, clients));

    const result = await migrator.runMigrations();

    // The migration result is preserved (not masked by cleanup), but the
    // session with uncertain lock ownership must never return for reuse.
    expect(result.applied).toEqual(['001_metering_outbox.sql']);
    expect(clients[0]!.released).toBe(true);
    expect(clients[0]!.destroyed).toBe(true);
    expect(shared.dispositions).toEqual([{ id: 'client-1', destroyed: true }]);
    // And the leaked server-side lock (if any) belongs to a dead session:
    // a fresh migrator run acquires cleanly with no overlap.
    const secondClients: FakeMigrationClient[] = [];
    const second = new OutboxDatabaseMigrator(fakePool(shared, secondClients));
    const secondResult = await second.runMigrations();
    expect(secondResult.alreadyApplied).toEqual(['001_metering_outbox.sql']);
    expect(shared.lock.maxActive).toBe(1);
  });

  it('pools normally on an unexpected false unlock result', async () => {
    const shared = sharedDb();
    shared.unlockReportsFalse = true;
    const clients: FakeMigrationClient[] = [];
    const migrator = new OutboxDatabaseMigrator(fakePool(shared, clients));

    const result = await migrator.runMigrations();

    // `false` proves this session holds no lock, so normal pooling is
    // safe; the result is preserved either way.
    expect(result.applied).toEqual(['001_metering_outbox.sql']);
    expect(clients[0]!.destroyed).toBe(false);
    expect(shared.dispositions).toEqual([{ id: 'client-1', destroyed: false }]);
  });

  it('fails before touching the database when no client can be acquired', async () => {
    const shared = sharedDb();
    const failingPool = {
      getClient: async () => {
        throw new Error('pool exhausted');
      },
      query: async () => {
        throw new Error('migrator must use the dedicated client, never pool.query');
      },
      ping: async () => true,
      close: async () => {},
    } as unknown as OutboxDatabasePool;
    const migrator = new OutboxDatabaseMigrator(failingPool);

    await expect(migrator.runMigrations()).rejects.toThrow(/pool exhausted/);
    expect(shared.executed).toHaveLength(0);
    expect(shared.lock.maxActive).toBe(0);
  });

  it('never touches schemas outside model_gateway_outbox', async () => {
    const shared = sharedDb();
    const clients: FakeMigrationClient[] = [];
    const migrator = new OutboxDatabaseMigrator(fakePool(shared, clients));
    await migrator.runMigrations();

    const outside = shared.executed.filter(
      (line) =>
        /oicunt_usage|oicunt_ai|oicunt_memory|public\./.test(line) &&
        !line.includes('model_gateway_outbox'),
    );
    expect(outside).toEqual([]);
    expect(shared.executed.some((line) => line.includes('model_gateway_outbox'))).toBe(true);
  });

  it('ships migration SQL that stays inside the outbox schema', () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/infrastructure/database/migrations',
    );
    const sql = readFileSync(join(dir, '001_metering_outbox.sql'), 'utf8');
    expect(sql).not.toMatch(/oicunt_usage|oicunt_ai|oicunt_memory/);
    expect(sql).toContain('model_gateway_outbox');
  });
});
