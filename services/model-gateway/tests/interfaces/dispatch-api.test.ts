import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelGatewayService } from '../../src/service.js';
import { loadModelGatewayConfig } from '../../src/config.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';
import { createInternalServiceToken } from '../../src/infrastructure/security/internal-service-token.js';

describe('Model Gateway HTTP Dispatch API (POST /internal/v1/models/dispatch)', () => {
  let service: ModelGatewayService;
  let port: number;
  let fakeAdapter: FakeProviderAdapter;

  beforeEach(async () => {
    fakeAdapter = new FakeProviderAdapter('anthropic');
    service = new ModelGatewayService({
      config: loadModelGatewayConfig({
        port: 0,
        logLevel: 'silent',
        allowedServiceIdentities: ['ai-orchestrator', 'ai-platform-admin'],
      }),
    });
    service.getAdapterRegistry().register(fakeAdapter);
    port = await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  const validPayload = {
    requestId: 'req-api-1',
    correlationId: 'corr-api-1',
    canonicalModelId: 'claude-sonnet',
    version: '1.0.0',
    stream: false,
    messages: [{ role: 'user', content: 'Hello API' }],
    limits: {
      contextWindowTokens: 100000,
      maxOutputTokens: 4096,
    },
    pricing: {
      costPerMillionInputTokens: 3.0,
      costPerMillionOutputTokens: 15.0,
    },
    eligibleTargets: [
      {
        targetId: 'target-1',
        provider: 'anthropic' as const,
        upstreamModelId: 'claude-3-5-sonnet',
        priority: 1,
        weight: 100,
        supportsStreaming: true,
      },
    ],
    routingPolicy: {
      strategy: 'priority-fallback' as const,
      maxFallbackAttempts: 2,
      requireHealthyTarget: true,
      degradationBehavior: 'fail-fast' as const,
    },
    actorId: 'test-actor',
  };

  it('rejects unauthenticated requests or unauthorized service identities with 403', async () => {
    // Missing service name header
    const resNoAuth = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    expect(resNoAuth.status).toBe(403);
    const bodyNoAuth = (await resNoAuth.json()) as { error: { code: string } };
    expect(bodyNoAuth.error.code).toBe('FORBIDDEN_SERVICE_IDENTITY');

    // Unauthorized service name header
    const resForbidden = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'malicious-service',
      },
      body: JSON.stringify(validPayload),
    });
    expect(resForbidden.status).toBe(403);
  });

  it('handles unary dispatch successfully and returns normalized JSON completion', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'ai-orchestrator',
        'X-Correlation-ID': 'corr-api-1',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = (await res.json()) as {
      success: boolean;
      data: {
        completionId: string;
        model: string;
        message: { content: Array<{ text: string }> };
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.completionId).toBeDefined();
    expect(body.data.message.content[0]?.text).toBe('Hello from fake provider');
  });

  it('handles streaming dispatch and streams SSE events', async () => {
    fakeAdapter.setStreamEvents([
      { event: 'token', data: { delta: 'Streamed ' } },
      { event: 'token', data: { delta: 'text!' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
        },
      },
    ]);

    const streamingPayload = {
      ...validPayload,
      stream: true,
    };

    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'ai-orchestrator',
      },
      body: JSON.stringify(streamingPayload),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const rawText = await res.text();
    expect(rawText).toContain('event: token\n');
    expect(rawText).toContain('Streamed ');
    expect(rawText).toContain('text!');
    expect(rawText).toContain('event: finish\n');
  });

  it('rejects malformed payload missing eligible targets with 503 ALL_TARGETS_EXHAUSTED', async () => {
    const invalidPayload = {
      ...validPayload,
      eligibleTargets: [],
    };

    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'ai-orchestrator',
      },
      body: JSON.stringify(invalidPayload),
    });

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ALL_TARGETS_EXHAUSTED');
  });

  it('returns 405 Method Not Allowed for non-POST dispatch request', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'GET',
      headers: {
        'X-Service-Name': 'ai-orchestrator',
      },
    });

    expect(res.status).toBe(405);
  });

  it('returns HTTP 413 PAYLOAD_TOO_LARGE when body exceeds maxBodySizeBytes (Fix 4)', async () => {
    const smallLimitService = new ModelGatewayService({
      config: loadModelGatewayConfig({
        port: 0,
        logLevel: 'silent',
        allowedServiceIdentities: ['ai-orchestrator'],
        maxBodySizeBytes: 50,
      }),
    });
    const smallPort = await smallLimitService.start();
    try {
      const res = await fetch(`http://127.0.0.1:${smallPort}/internal/v1/models/dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Service-Name': 'ai-orchestrator',
        },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(body.error.message).toBe('Request payload exceeds maximum allowed size.');
    } finally {
      await smallLimitService.stop();
    }
  });

  it('returns HTTP 400 INVALID_REQUEST when request body is empty (Fix 4)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'ai-orchestrator',
      },
      body: '',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toBe('Request body must not be empty.');
  });
});

describe('Model Gateway HTTP Dispatch API - Internal Token Authentication', () => {
  let service: ModelGatewayService;
  let port: number;
  let fakeAdapter: FakeProviderAdapter;
  const secret = 'mgw-test-secret';

  beforeEach(async () => {
    fakeAdapter = new FakeProviderAdapter('anthropic');
    service = new ModelGatewayService({
      config: loadModelGatewayConfig({
        port: 0,
        logLevel: 'silent',
        internalToken: secret,
        allowedServiceIdentities: ['inference'],
      }),
    });
    service.getAdapterRegistry().register(fakeAdapter);
    port = await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  const validPayload = {
    requestId: 'req-auth-1',
    correlationId: 'corr-auth-1',
    canonicalModelId: 'claude-sonnet',
    version: '1.0.0',
    stream: false,
    messages: [{ role: 'user', content: 'Hello API' }],
    limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
    pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
    eligibleTargets: [
      {
        targetId: 'target-1',
        provider: 'anthropic' as const,
        upstreamModelId: 'claude-3-5-sonnet',
        priority: 1,
        weight: 100,
        supportsStreaming: true,
      },
    ],
    routingPolicy: {
      strategy: 'priority-fallback' as const,
      maxFallbackAttempts: 2,
      requireHealthyTarget: true,
      degradationBehavior: 'fail-fast' as const,
    },
    actorId: 'test-actor',
  };

  it('succeeds with valid internal token from allowed service', async () => {
    const token = createInternalServiceToken({
      serviceName: 'inference',
      audience: 'model-gateway',
      secret,
    });

    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Service-Name': 'inference',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('rejects with 401 when token is missing', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Name': 'inference',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(401);
  });

  it('rejects with 401 when token signature is invalid', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.token.signature',
        'X-Service-Name': 'inference',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(401);
  });

  it('rejects with 403 when token audience is wrong', async () => {
    const token = createInternalServiceToken({
      serviceName: 'inference',
      audience: 'wrong-audience',
      secret,
    });

    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Service-Name': 'inference',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(403);
  });

  it('rejects with 403 when token subject is not in allowed services', async () => {
    const token = createInternalServiceToken({
      serviceName: 'rogue-service',
      audience: 'model-gateway',
      secret,
    });

    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Service-Name': 'rogue-service',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(403);
  });

  it('rejects with 403 when X-Service-Name is spoofed to mismatch token subject', async () => {
    const token = createInternalServiceToken({
      serviceName: 'inference',
      audience: 'model-gateway',
      secret,
    });

    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Service-Name': 'admin-service',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(403);
  });
});
