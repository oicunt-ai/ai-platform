import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { ServiceInstance, loadAiServiceConfig } from '../../src/index.js';

interface HealthTestResponseBody {
  readonly success?: boolean;
  readonly data?: {
    readonly status?: string;
    readonly serviceName?: string;
    readonly version?: string;
    readonly timestamp?: string;
  };
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
  readonly meta?: {
    readonly timestamp?: string;
    readonly correlationId?: string;
  };
}

function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: HealthTestResponseBody; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data) as HealthTestResponseBody;
          resolve({ status: res.statusCode ?? 500, body: json, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode ?? 500, body: {}, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
  });
}

describe('AI Service Template Health & HTTP Integration', () => {
  let service: ServiceInstance;
  let port: number;

  beforeAll(async () => {
    const config = loadAiServiceConfig({
      serviceName: 'test-health-service',
      port: 0, // OS assigned ephemeral port
    });
    service = new ServiceInstance({ config });
    port = await service.start();
  });

  afterAll(async () => {
    await service.stop();
  });

  it('responds with 200 on /healthz', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.status).toBe('alive');
    expect(res.body.data?.serviceName).toBe('test-health-service');
  });

  it('responds with 200 on /readyz when initialized', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/readyz`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.status).toBe('ready');
  });

  it('propagates incoming X-Correlation-ID', async () => {
    const correlationId = 'test-corr-id-999';
    const res = await httpGet(`http://127.0.0.1:${port}/healthz`, {
      'X-Correlation-ID': correlationId,
    });
    expect(res.headers['x-correlation-id']).toBe(correlationId);
  });

  it('returns 404 for unknown endpoints', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/unknown-route`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.code).toBe('ROUTE_NOT_FOUND');
  });
});
