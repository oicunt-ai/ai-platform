import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelGatewayService } from '../../src/service.js';
import { loadModelGatewayConfig } from '../../src/config.js';
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

describe('Model Gateway HTTP Health API', () => {
  let service: ModelGatewayService;
  let port: number;

  beforeEach(async () => {
    service = new ModelGatewayService({
      config: loadModelGatewayConfig({
        port: 0,
        logLevel: 'silent',
      }),
      adapterRegistry: new InMemoryAdapterRegistry([new FakeProviderAdapter('test-provider')]),
    });
    port = await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  it('responds with 200 OK for /healthz (liveness)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; serviceName: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('alive');
    expect(body.data.serviceName).toBe('model-gateway');
  });

  it('responds with 200 OK for /health/liveness alias', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health/liveness`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: { status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('alive');
  });

  it('responds with 200 OK for /readyz when ready', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: { status: string; serviceName: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ready');
  });

  it('responds with 200 OK for /health/readiness alias', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health/readiness`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: { status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ready');
  });
});
