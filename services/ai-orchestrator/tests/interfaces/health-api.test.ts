import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiOrchestratorService } from '../../src/service.js';
import { loadAiOrchestratorConfig } from '../../src/config.js';
import { FakeModelRegistry } from '../test-doubles/fake-model-registry.js';
import { FakeInference } from '../test-doubles/fake-inference.js';
import { FakeMemory } from '../test-doubles/fake-memory.js';

interface TestHealthResponse {
  readonly success: boolean;
  readonly data?: {
    readonly status: string;
    readonly serviceName: string;
    readonly version: string;
    readonly checks?: Record<string, string>;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, string>;
  };
}

describe('HTTP Interfaces - Health API', () => {
  let service: AiOrchestratorService;
  let fakeMemory: FakeMemory;
  let baseUrl: string;

  beforeEach(async () => {
    fakeMemory = new FakeMemory();

    const config = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
    });

    service = new AiOrchestratorService({
      config,
      modelRegistry: new FakeModelRegistry(),
      inference: new FakeInference(),
      memory: fakeMemory,
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
    expect(body1.data?.status).toBe('alive');

    const res2 = await fetch(`${baseUrl}/healthz`);
    expect(res2.status).toBe(200);
  });

  it('returns 200 OK for /health/readiness and /readyz when service and dependencies are ready', async () => {
    const res1 = await fetch(`${baseUrl}/health/readiness`);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as TestHealthResponse;
    expect(body1.success).toBe(true);
    expect(body1.data?.status).toBe('ready');
    expect(body1.data?.checks?.['memory']).toBe('ok');

    const res2 = await fetch(`${baseUrl}/readyz`);
    expect(res2.status).toBe(200);
  });

  it('returns 503 for /health/readiness and /readyz when Memory service is unhealthy', async () => {
    fakeMemory.isHealthy = false;

    const res1 = await fetch(`${baseUrl}/health/readiness`);
    expect(res1.status).toBe(503);
    const body1 = (await res1.json()) as TestHealthResponse;
    expect(body1.success).toBe(false);
    expect(body1.error?.code).toBe('SERVICE_NOT_READY');
    expect(body1.error?.details?.['memory']).toBe('failed');

    const res2 = await fetch(`${baseUrl}/readyz`);
    expect(res2.status).toBe(503);
  });
});
