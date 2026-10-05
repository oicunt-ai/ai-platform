import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiOrchestratorService } from '../../src/service.js';
import { loadAiOrchestratorConfig } from '../../src/config.js';
import { FakeModelRegistry } from '../test-doubles/fake-model-registry.js';
import { FakeModelGateway } from '../test-doubles/fake-model-gateway.js';

interface TestHealthResponse {
  readonly success: boolean;
  readonly data: {
    readonly status: string;
    readonly serviceName: string;
    readonly version: string;
  };
}

describe('HTTP Interfaces - Health API', () => {
  let service: AiOrchestratorService;
  let baseUrl: string;

  beforeEach(async () => {
    const config = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
    });

    service = new AiOrchestratorService({
      config,
      modelRegistry: new FakeModelRegistry(),
      modelGateway: new FakeModelGateway(),
    });

    const port = await service.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await service.stop();
  });

  it('returns 200 OK for /health/liveness and /healthz', async () => {
    const res1 = await fetch(`${baseUrl}/health/liveness`);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as TestHealthResponse;
    expect(body1.success).toBe(true);
    expect(body1.data.status).toBe('alive');

    const res2 = await fetch(`${baseUrl}/healthz`);
    expect(res2.status).toBe(200);
  });

  it('returns 200 OK for /health/readiness and /readyz when service is ready', async () => {
    const res1 = await fetch(`${baseUrl}/health/readiness`);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as TestHealthResponse;
    expect(body1.success).toBe(true);
    expect(body1.data.status).toBe('ready');

    const res2 = await fetch(`${baseUrl}/readyz`);
    expect(res2.status).toBe(200);
  });
});
