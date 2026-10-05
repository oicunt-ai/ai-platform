import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiOrchestratorService } from '../../src/service.js';
import { loadAiOrchestratorConfig } from '../../src/config.js';
import { FakeModelRegistry } from '../test-doubles/fake-model-registry.js';
import { FakeModelGateway } from '../test-doubles/fake-model-gateway.js';

interface TestChatResponse {
  readonly success: boolean;
  readonly data?: {
    readonly model: string;
    readonly message: { readonly role: string; readonly content: unknown };
  };
  readonly meta?: {
    readonly correlationId: string;
    readonly requestId: string;
  };
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

describe('HTTP Interfaces - Chat API', () => {
  let service: AiOrchestratorService;
  let fakeRegistry: FakeModelRegistry;
  let fakeGateway: FakeModelGateway;
  let baseUrl: string;

  beforeEach(async () => {
    fakeRegistry = new FakeModelRegistry();
    fakeGateway = new FakeModelGateway();

    const config = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalToken: 'test-secret-token',
      allowedServiceIdentities: ['billy-api', 'platform-api-gateway'],
    });

    service = new AiOrchestratorService({
      config,
      modelRegistry: fakeRegistry,
      modelGateway: fakeGateway,
    });

    const port = await service.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await service.stop();
  });

  it('completes unary chat request successfully', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
        'X-Correlation-ID': 'corr-abc-123',
        'X-User-ID': 'usr_999',
      },
      body: JSON.stringify({
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Hello!' }],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as TestChatResponse;
    expect(body.success).toBe(true);
    expect(body.data?.model).toBe('claude-sonnet');
    expect(body.data?.message.role).toBe('assistant');
    expect(body.meta?.correlationId).toBe('corr-abc-123');
  });

  it('bypasses resolution cache when Cache-Control: no-cache header is sent', async () => {
    // 1st request: Populates cache
    const res1 = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
      },
      body: JSON.stringify({
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Turn 1' }],
      }),
    });
    expect(res1.status).toBe(200);
    expect(fakeRegistry.recordedQueries).toHaveLength(1);

    // 2nd request: Hits cache (no new registry query)
    const res2 = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
      },
      body: JSON.stringify({
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Turn 2' }],
      }),
    });
    expect(res2.status).toBe(200);
    expect(fakeRegistry.recordedQueries).toHaveLength(1);

    // 3rd request with Cache-Control: no-cache: Bypasses cache and queries registry
    const res3 = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Turn 3 with no-cache' }],
      }),
    });
    expect(res3.status).toBe(200);
    expect(fakeRegistry.recordedQueries).toHaveLength(2);
  });

  it('streams Server-Sent Events successfully when stream: true', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
        'X-Correlation-ID': 'corr-stream-123',
      },
      body: JSON.stringify({
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Stream this!' }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const text = await response.text();
    expect(text).toContain('event: token');
    expect(text).toContain('event: finish');
  });

  it('rejects unauthorized requests with 401 when token is invalid', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token',
        'X-Service-Name': 'billy-api',
      },
      body: JSON.stringify({
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as TestChatResponse;
    expect(body.error?.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rejects forbidden services with 403 when X-Service-Name is not whitelisted', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'unauthorized-service',
      },
      body: JSON.stringify({
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(response.status).toBe(403);
    const body = (await response.json()) as TestChatResponse;
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  it('returns 400 when canonical model identifier is missing', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as TestChatResponse;
    expect(body.error?.code).toBe('INVALID_REQUEST');
  });

  it('returns 404 when model does not exist in registry', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
      },
      body: JSON.stringify({
        model: 'non-existent-model',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as TestChatResponse;
    expect(body.error?.code).toBe('MODEL_NOT_FOUND');
  });

  it('returns 405 Method Not Allowed for GET on /internal/v1/orchestrator/chat', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/orchestrator/chat`, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer test-secret-token',
        'X-Service-Name': 'billy-api',
      },
    });

    expect(response.status).toBe(405);
  });

  it('returns 404 for unknown route', async () => {
    const response = await fetch(`${baseUrl}/unknown/route`, {
      method: 'GET',
    });

    expect(response.status).toBe(404);
  });
});
