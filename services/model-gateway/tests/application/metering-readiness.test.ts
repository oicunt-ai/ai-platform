/**
 * Service-level metering readiness tests over real HTTP.
 *
 * Proves the /readyz contract with fakes only: broker-down keeps inference
 * ready while capture works; dead capture fails closed; disabled metering
 * keeps the legacy shape. No database or broker is contacted.
 */
import { describe, expect, it } from 'vitest';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import { loadModelGatewayConfig } from '../../src/config.js';
import { ModelGatewayService } from '../../src/service.js';
import type { OutboxDatabasePool } from '../../src/infrastructure/database/connection.js';
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

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

class FakeOutboxPool {
  public statements: string[] = [];
  public pingOk = true;

  async query(text: string, _params?: readonly unknown[]) {
    this.statements.push(text);
    if (text.includes('information_schema.tables')) {
      return { rows: [{ present: true }], rowCount: 1 };
    }
    if (text.includes('information_schema.columns')) {
      return {
        rows: OUTBOX_COLUMNS.map((column_name) => ({ column_name })),
        rowCount: OUTBOX_COLUMNS.length,
      };
    }
    if (text.includes('SELECT status, COUNT(*)')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('ORDER BY captured_at ASC')) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("status = 'sending' AND lease_expires_at")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('UPDATE model_gateway_outbox.metering_outbox')) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`FakeOutboxPool: unexpected statement: ${text.slice(0, 80)}`);
  }

  async ping(): Promise<boolean> {
    return this.pingOk;
  }

  async close(): Promise<void> {}

  async getClient(): Promise<never> {
    throw new Error('FakeOutboxPool issues no clients');
  }
}

class FakePublisher {
  public sent: UsageEvent[] = [];
  constructor(public readyFlag = true) {}
  async start(): Promise<void> {}
  async close(): Promise<void> {}
  isReady(): boolean {
    return this.readyFlag;
  }
  async send(event: UsageEvent): Promise<void> {
    this.sent.push(event);
  }
  async publish(event: UsageEvent): Promise<void> {
    return this.send(event);
  }
}

function baseConfig(overrides?: Parameters<typeof loadModelGatewayConfig>[0]) {
  return loadModelGatewayConfig({
    port: 0,
    host: '127.0.0.1',
    environment: 'test',
    logLevel: 'silent',
    ...overrides,
  });
}

function withAdapter() {
  return new InMemoryAdapterRegistry([new FakeProviderAdapter('test-provider')]);
}

async function readyz(port: number): Promise<{ status: number; body: ReadinessBody }> {
  const res = await fetch(`http://127.0.0.1:${port}/readyz`);
  return { status: res.status, body: (await res.json()) as ReadinessBody };
}

interface ReadinessBody {
  readonly success?: boolean;
  readonly data?: { readonly checks?: Record<string, string> };
  readonly error?: { readonly code?: string; readonly details?: Record<string, string> };
}

describe('metering readiness over HTTP', () => {
  it('stays ready with metering checks while the broker is down', async () => {
    const pool = new FakeOutboxPool();
    const publisher = new FakePublisher(false);
    const service = new ModelGatewayService({
      config: baseConfig({ enableUsagePublishing: true }),
      adapterRegistry: withAdapter(),
      outboxPool: pool as unknown as OutboxDatabasePool,
      usagePublisher: publisher,
    });
    const port = await service.start();
    try {
      const { status, body } = await readyz(port);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data?.checks).toEqual({ capture: 'ok', publisher: 'failed', backlog: 'ok' });
      expect(service.getMeteringHealth()).toMatchObject({
        enabled: true,
        captureHealthy: true,
        publisherReady: false,
        pending: 0,
        failed: 0,
      });
    } finally {
      await service.stop();
    }
  });

  it('fails closed when the capture store dies, even with the broker up', async () => {
    const pool = new FakeOutboxPool();
    const publisher = new FakePublisher(true);
    const service = new ModelGatewayService({
      config: baseConfig({ enableUsagePublishing: true, meteringCaptureCheckIntervalMs: 20 }),
      adapterRegistry: withAdapter(),
      outboxPool: pool as unknown as OutboxDatabasePool,
      usagePublisher: publisher,
    });
    const port = await service.start();
    try {
      pool.pingOk = false;
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { status, body } = await readyz(port);
      expect(status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('SERVICE_NOT_READY');
      expect(body.error?.details).toMatchObject({ capture: 'failed' });
      expect(service.getMeteringHealth().captureHealthy).toBe(false);
    } finally {
      await service.stop();
    }
  });

  it('keeps the legacy readiness shape when metering is disabled', async () => {
    const service = new ModelGatewayService({
      config: baseConfig(),
      adapterRegistry: withAdapter(),
    });
    expect(service.getMeteringCapture()).toBeUndefined();
    expect(service.getMeteringHealth()).toMatchObject({ enabled: false });
    const port = await service.start();
    try {
      const { status, body } = await readyz(port);
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data?.checks).toBeUndefined();
    } finally {
      await service.stop();
    }
  });

  it('runs capture-only without a sender and stays ready on capture health', async () => {
    const pool = new FakeOutboxPool();
    const service = new ModelGatewayService({
      config: baseConfig({ enableUsagePublishing: true }),
      adapterRegistry: withAdapter(),
      outboxPool: pool as unknown as OutboxDatabasePool,
    });
    const port = await service.start();
    try {
      expect(service.getMeteringCapture()).toBeDefined();
      const { status, body } = await readyz(port);
      expect(status).toBe(200);
      expect(body.data?.checks).toEqual({ capture: 'ok', publisher: 'failed', backlog: 'ok' });
    } finally {
      await service.stop();
    }
  });
});
