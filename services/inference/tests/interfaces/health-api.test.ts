import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InferenceService } from '../../src/service.js';
import { loadInferenceConfig } from '../../src/config.js';
import { FakeModelGateway } from '../test-doubles/fake-model-gateway.js';

describe('HTTP Interfaces - Health API', () => {
  let service: InferenceService;
  let fakeGateway: FakeModelGateway;
  let baseUrl: string;

  beforeEach(async () => {
    fakeGateway = new FakeModelGateway();
    const config = loadInferenceConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
    });

    service = new InferenceService({
      config,
      modelGateway: fakeGateway,
    });

    const port = await service.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await service.stop();
  });

  it('returns 200 OK for /healthz', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('inference');
  });

  it('returns 200 OK for /readyz when service and dependencies are healthy', async () => {
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ready');
    expect(body.service).toBe('inference');
  });

  it('returns 503 Service Unavailable for /readyz when Model Gateway is unhealthy', async () => {
    fakeGateway.isHealthy = false;
    const res = await fetch(`${baseUrl}/readyz`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('degraded');
  });
});
