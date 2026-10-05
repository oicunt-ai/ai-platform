import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InferenceService } from '../../src/service.js';
import { loadInferenceConfig } from '../../src/config.js';
import { FakeModelGateway } from '../test-doubles/fake-model-gateway.js';
import type { InferenceExecutionResponse } from '../../src/application/dtos/inference-result.dto.js';

describe('HTTP Interfaces - Inference API', () => {
  let service: InferenceService;
  let fakeGateway: FakeModelGateway;
  let baseUrl: string;
  const internalToken = 'test-secret-token';

  beforeEach(async () => {
    fakeGateway = new FakeModelGateway();
    const config = loadInferenceConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalToken,
      allowedServiceIdentities: ['ai-orchestrator', 'billing-service'],
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

  const validPayload = {
    canonicalModelId: 'claude-sonnet',
    messages: [{ role: 'user', content: 'What is the speed of light?' }],
    limits: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 8192,
    },
    deadlineMs: Date.now() + 60_000,
  };

  it('executes unary inference successfully with valid headers and payload', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/inference/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalToken}`,
        'X-Service-Name': 'ai-orchestrator',
        'X-Correlation-Id': 'corr_api_test_01',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-correlation-id')).toBe('corr_api_test_01');

    const body = (await res.json()) as InferenceExecutionResponse;
    expect(body.success).toBe(true);
    expect(body.data.model).toBe('claude-sonnet');
    expect(body.data.finishReason).toBe('stop');
    expect(body.meta.correlationId).toBe('corr_api_test_01');
  });

  it('streams inference events as SSE when stream: true', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/inference/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalToken}`,
        'X-Service-Name': 'ai-orchestrator',
      },
      body: JSON.stringify({
        ...validPayload,
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('event: token');
    expect(text).toContain('event: finish');
  });

  it('returns 401 Unauthorized when internal token is invalid or missing', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/inference/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
        'X-Service-Name': 'ai-orchestrator',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('returns 403 Forbidden when service identity is not whitelisted', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/inference/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalToken}`,
        'X-Service-Name': 'unauthorized-external-app',
      },
      body: JSON.stringify(validPayload),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 Bad Request when request body is invalid', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/inference/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${internalToken}`,
        'X-Service-Name': 'ai-orchestrator',
      },
      body: JSON.stringify({
        // Missing canonicalModelId, limits, deadlineMs
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 405 Method Not Allowed for GET on execute endpoint', async () => {
    const res = await fetch(`${baseUrl}/internal/v1/inference/execute`, {
      method: 'GET',
    });

    expect(res.status).toBe(405);
  });

  it('returns 404 Not Found for non-existent endpoint', async () => {
    const res = await fetch(`${baseUrl}/non/existent/path`, {
      method: 'GET',
    });

    expect(res.status).toBe(404);
  });
});
