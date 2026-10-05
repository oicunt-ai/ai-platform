import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModelRegistryService } from '../../src/service.js';

describe('HTTP Health Probes Integration', () => {
  let service: ModelRegistryService;
  let port: number;

  beforeAll(async () => {
    service = new ModelRegistryService({
      config: {
        serviceName: 'model-registry',
        environment: 'test',
        port: 0,
        host: '127.0.0.1',
        version: '0.1.0',
        shutdownTimeoutMs: 1000,
        enableTelemetry: false,
        logLevel: 'silent',
        database: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'postgres',
          ssl: false,
          maxConnections: 1,
          idleTimeoutMs: 1000,
          connectionTimeoutMs: 1000,
        },
        cache: {
          enabled: false,
          defaultTtlSeconds: 60,
          staleTtlSeconds: 300,
        },
        allowedServiceIdentities: ['ai-orchestrator', 'model-gateway', 'ai-platform-admin'],
        maxBodySizeBytes: 1048576,
      },
    });

    port = await service.start();
  });

  afterAll(async () => {
    await service.stop();
  });

  it('GET /healthz returns 200 OK alive', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      success: boolean;
      data: { status: string; serviceName: string };
    };
    expect(data.success).toBe(true);
    expect(data.data.status).toBe('alive');
    expect(data.data.serviceName).toBe('model-registry');
  });

  it('GET /readyz returns 200 OK ready', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { success: boolean; data: { status: string } };
    expect(data.success).toBe(true);
    expect(data.data.status).toBe('ready');
  });
});
