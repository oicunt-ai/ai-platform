/**
 * Regression tests for the explicit migration destination contract.
 *
 * The migrate command must refuse to proceed unless host, port, database,
 * user, and password are all intentionally configured — never silently
 * defaulting to localhost:5432 or anywhere else for a schema-changing
 * operation. No live database is contacted; pools are faked.
 */
import { describe, expect, it, vi } from 'vitest';
import { requireExplicitOutboxTarget, type ExplicitOutboxTarget } from '../../src/config.js';
import { runOutboxMigration } from '../../src/migrate.js';
import type { OutboxDatabasePool } from '../../src/infrastructure/database/connection.js';

const FULL_ENV: Record<string, string> = {
  OUTBOX_DB_HOST: '127.0.0.1',
  OUTBOX_DB_PORT: '5433',
  OUTBOX_DB_NAME: 'oicunt_ai',
  OUTBOX_DB_USER: 'postgres',
  OUTBOX_DB_PASSWORD: 'test-password',
};

describe('requireExplicitOutboxTarget', () => {
  it('resolves a fully explicit OUTBOX_DB_* destination', () => {
    expect(requireExplicitOutboxTarget({ ...FULL_ENV })).toEqual({
      host: '127.0.0.1',
      port: 5433,
      database: 'oicunt_ai',
      user: 'postgres',
      password: 'test-password',
    });
  });

  it('falls back to DATABASE_* preserving precedence', () => {
    expect(
      requireExplicitOutboxTarget({
        DATABASE_HOST: 'db.internal',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'oicunt_ai',
        DATABASE_USER: 'migrator',
        DATABASE_PASSWORD: 'pw',
      }),
    ).toMatchObject({ host: 'db.internal', port: 5432, database: 'oicunt_ai', user: 'migrator' });
    expect(
      requireExplicitOutboxTarget({
        ...FULL_ENV,
        DATABASE_HOST: 'db.internal',
        DATABASE_PORT: '5432',
        DATABASE_NAME: 'other',
        DATABASE_USER: 'other',
        DATABASE_PASSWORD: 'other',
      }),
    ).toMatchObject({ host: '127.0.0.1', port: 5433, database: 'oicunt_ai', user: 'postgres' });
  });

  it('refuses an empty environment naming every required variable', () => {
    expect(() => requireExplicitOutboxTarget({})).toThrow(/OUTBOX_DB_HOST/);
    expect(() => requireExplicitOutboxTarget({})).toThrow(/OUTBOX_DB_NAME/);
    expect(() => requireExplicitOutboxTarget({})).toThrow(/OUTBOX_DB_USER/);
    expect(() => requireExplicitOutboxTarget({})).toThrow(/OUTBOX_DB_PASSWORD/);
    expect(() => requireExplicitOutboxTarget({})).toThrow(/OUTBOX_DB_PORT/);
  });

  it('treats blank values as unset and rejects partial configuration', () => {
    expect(() => requireExplicitOutboxTarget({ ...FULL_ENV, OUTBOX_DB_HOST: '   ' })).toThrow(
      /OUTBOX_DB_HOST/,
    );
    expect(() =>
      requireExplicitOutboxTarget({
        OUTBOX_DB_HOST: '127.0.0.1',
        OUTBOX_DB_PORT: '5433',
      }),
    ).toThrow(/OUTBOX_DB_NAME/);
  });

  it.each(['abc', '0', '-1', '65536', '54.5', ''])('rejects invalid port %j', (port) => {
    expect(() => requireExplicitOutboxTarget({ ...FULL_ENV, OUTBOX_DB_PORT: port })).toThrow(
      /OUTBOX_DB_PORT \(or DATABASE_PORT, integer 1-65535\)/,
    );
  });

  it('never falls back to localhost:5432-style defaults', () => {
    // Even a single missing field fails: defaults must not fill the gap.
    const withoutPort = { ...FULL_ENV };
    delete withoutPort['OUTBOX_DB_PORT'];
    expect(() => requireExplicitOutboxTarget(withoutPort)).toThrow(/OUTBOX_DB_PORT/);
  });
});

describe('runOutboxMigration destination safety', () => {
  /** Runs the entrypoint with process.exit captured (never really exiting). */
  async function runCaptured(options: Parameters<typeof runOutboxMigration>[0]): Promise<{
    exitCodes: unknown[];
  }> {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    try {
      await runOutboxMigration(options);
      return { exitCodes: exit.mock.calls.map((call) => call[0]) };
    } finally {
      exit.mockRestore();
    }
  }

  function fakePool(options?: {
    identity?: { version: string; database: string; user: string };
    failIdentity?: boolean;
  }) {
    const statements: string[] = [];
    let closed = false;
    const record = (text: string): void => {
      statements.push(text.split('\n')[0]?.trim() ?? text);
    };
    const fakeClient = {
      async query(text: string) {
        record(`client: ${text}`);
        if (text.includes('FROM model_gateway_outbox._migrations')) {
          return { rows: [{ name: '001_metering_outbox.sql' }], rowCount: 1 };
        }
        return { rows: [], rowCount: null };
      },
      release() {},
    };
    return {
      statements,
      get closed() {
        return closed;
      },
      pool: {
        async query(text: string) {
          record(text);
          if (options?.failIdentity) {
            throw new Error('connection refused');
          }
          if (text.includes('current_database()')) {
            const identity = options?.identity ?? {
              version: 'PostgreSQL 16.15',
              database: 'oicunt_ai',
              user: 'postgres',
            };
            return { rows: [identity], rowCount: 1 };
          }
          if (text.includes('pg_advisory_lock') || text.includes('pg_advisory_unlock')) {
            return { rows: [], rowCount: null };
          }
          if (text.includes('FROM model_gateway_outbox._migrations')) {
            return { rows: [{ name: '001_metering_outbox.sql' }], rowCount: 1 };
          }
          return { rows: [], rowCount: null };
        },
        async getClient() {
          return fakeClient as never;
        },
        async close() {
          closed = true;
        },
      } as unknown as OutboxDatabasePool,
    };
  }

  it('refuses before creating any pool when the destination is not configured', async () => {
    const errors: string[] = [];
    const created: ExplicitOutboxTarget[] = [];
    const { exitCodes } = await runCaptured({
      env: {},
      createPool: (target) => {
        created.push(target);
        return fakePool().pool;
      },
      log: () => {},
      logError: (line) => errors.push(line),
    });
    expect(created).toHaveLength(0);
    expect(exitCodes).toEqual([1]);
    expect(errors.join('\n')).toContain('OUTBOX_DB_HOST');
  });

  it('honors the explicit destination and logs it without secrets', async () => {
    const lines: string[] = [];
    const created: ExplicitOutboxTarget[] = [];
    const fake = fakePool();
    const { exitCodes } = await runCaptured({
      env: { ...FULL_ENV },
      createPool: (target) => {
        created.push(target);
        return fake.pool;
      },
      log: (line) => lines.push(line),
      logError: () => {},
    });
    expect(exitCodes).toEqual([]);
    expect(created).toEqual([
      {
        host: '127.0.0.1',
        port: 5433,
        database: 'oicunt_ai',
        user: 'postgres',
        password: 'test-password',
      },
    ]);
    const logged = lines.join('\n');
    expect(logged).toContain('127.0.0.1:5433/oicunt_ai');
    expect(logged).toContain('postgres');
    expect(logged).not.toContain('test-password');
    expect(logged).toContain('already-applied=1');
    expect(fake.closed).toBe(true);
  });

  it('refuses when the live connection identity mismatches the target', async () => {
    const errors: string[] = [];
    const fake = fakePool({
      identity: { version: 'PostgreSQL 16.15', database: 'oicunt_usage', user: 'postgres' },
    });
    const { exitCodes } = await runCaptured({
      env: { ...FULL_ENV },
      createPool: () => fake.pool,
      log: () => {},
      logError: (line) => errors.push(line),
    });
    expect(exitCodes).toEqual([1]);
    expect(errors.join('\n')).toContain("does not match configured migration target 'oicunt_ai'");
    // No migration DDL ran: the only statements are the identity probe.
    expect(fake.statements.every((s) => s.includes('current_database()'))).toBe(true);
    expect(fake.closed).toBe(true);
  });

  it('fails closed when the database is unreachable, closing the pool', async () => {
    const fake = fakePool({ failIdentity: true });
    const { exitCodes } = await runCaptured({
      env: { ...FULL_ENV },
      createPool: () => fake.pool,
      log: () => {},
      logError: () => {},
    });
    expect(exitCodes).toEqual([1]);
    expect(fake.closed).toBe(true);
  });
});
