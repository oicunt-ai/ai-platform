/**
 * Regression tests for metering-aware service startup.
 *
 * - A disabled gateway opens no outbox connection and behaves as before.
 * - An enabled gateway verifies the outbox schema read-only and refuses to
 *   boot on mismatch — ordinary startup NEVER applies migrations (no DDL).
 * - All database behavior is faked; no test opens a real connection.
 */
import { describe, expect, it } from 'vitest';
import { loadModelGatewayConfig } from '../../src/config.js';
import { ModelGatewayService } from '../../src/service.js';
import type { OutboxDatabasePool } from '../../src/infrastructure/database/connection.js';

const OUTBOX_COLUMNS = [
  'outbox_id',
  'event_id',
  'tenant_id',
  'idempotency_key',
  'event',
  'status',
  'attempts',
  'next_attempt_at',
  'lease_owner',
  'lease_expires_at',
  'last_error',
  'captured_at',
  'confirmed_at',
];

type FakeMode = 'compatible' | 'missing-table' | 'unreachable';

class FakeOutboxPool {
  public statements: string[] = [];
  constructor(private readonly mode: FakeMode) {}

  async query(text: string, _params?: readonly unknown[]) {
    this.statements.push(text);
    if (this.mode === 'unreachable') {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
    }
    if (text.includes('information_schema.tables')) {
      return { rows: [{ present: this.mode === 'compatible' }], rowCount: 1 };
    }
    if (text.includes('information_schema.columns')) {
      return {
        rows: OUTBOX_COLUMNS.map((column_name) => ({ column_name })),
        rowCount: OUTBOX_COLUMNS.length,
      };
    }
    throw new Error(`FakeOutboxPool: unexpected statement: ${text.slice(0, 80)}`);
  }

  async ping(): Promise<boolean> {
    return this.mode !== 'unreachable';
  }

  async close(): Promise<void> {}

  async getClient(): Promise<never> {
    throw new Error('FakeOutboxPool issues no clients');
  }
}

function ddlStatements(pool: FakeOutboxPool): string[] {
  return pool.statements.filter((s) =>
    /\b(CREATE|ALTER|DROP|TRUNCATE)\b|INSERT INTO .*_migrations/i.test(s),
  );
}

describe('metering-aware service startup', () => {
  it('starts normally with metering disabled and no capture wired', async () => {
    const config = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
    });
    const service = new ModelGatewayService({ config });
    expect(service.getMeteringCapture()).toBeUndefined();
    const port = await service.start();
    expect(port).toBeGreaterThan(0);
    await service.stop();
  });

  it('starts when metering is enabled and the outbox schema is compatible, issuing no DDL', async () => {
    const pool = new FakeOutboxPool('compatible');
    const config = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      enableUsagePublishing: true,
    });
    const service = new ModelGatewayService({
      config,
      outboxPool: pool as unknown as OutboxDatabasePool,
    });
    expect(service.getMeteringCapture()).toBeDefined();
    await service.start();
    await service.stop();
    expect(ddlStatements(pool)).toEqual([]);
    expect(pool.statements.some((s) => s.includes('information_schema'))).toBe(true);
  });

  it('refuses to start when the outbox table is missing, still issuing no DDL', async () => {
    const pool = new FakeOutboxPool('missing-table');
    const config = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      enableUsagePublishing: true,
    });
    const service = new ModelGatewayService({
      config,
      outboxPool: pool as unknown as OutboxDatabasePool,
    });
    await expect(service.start()).rejects.toThrow(/unverifiable metering outbox schema/);
    await service.stop();
    expect(ddlStatements(pool)).toEqual([]);
  });

  it('refuses to start when the outbox database is unreachable, still issuing no DDL', async () => {
    const pool = new FakeOutboxPool('unreachable');
    const config = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      enableUsagePublishing: true,
    });
    const service = new ModelGatewayService({
      config,
      outboxPool: pool as unknown as OutboxDatabasePool,
    });
    await expect(service.start()).rejects.toThrow();
    await service.stop();
    expect(ddlStatements(pool)).toEqual([]);
  });
});
