import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpModelRegistryClient } from '../../src/infrastructure/clients/http-model-registry.client.js';
import { HttpModelGatewayClient } from '../../src/infrastructure/clients/http-model-gateway.client.js';
import {
  DeadlineExceededError,
  ModelUnavailableError,
  ProviderExecutionFailedError,
  RateLimitedError,
  UnsupportedCapabilityError,
  UnsupportedModelError,
} from '../../src/domain/errors.js';

describe('HTTP Infrastructure Clients', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('HttpModelRegistryClient', () => {
    it('resolves model successfully with correct headers', async () => {
      const mockResult = {
        canonicalModelId: 'oicunt.model.embedding',
        version: '1.0.0',
        displayName: 'OICUNT Embedding',
        description: 'Test model',
        modalities: ['embedding'],
        status: 'available',
        resolvedAt: '2026-10-06T12:00:00Z',
        limits: { contextWindowTokens: 8192, maxOutputTokens: 1536 },
        capabilities: {
          streaming: false,
          toolCalling: false,
          structuredOutputs: false,
          reasoning: false,
          vision: false,
          audioInput: false,
          audioOutput: false,
          systemInstructions: false,
        },
        eligibleTargets: [
          {
            targetId: 'tgt-1',
            provider: 'openai',
            upstreamModelId: 'text-embedding-3-small',
            priority: 1,
            weight: 100,
          },
        ],
      };

      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(JSON.stringify({ success: true, data: mockResult }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = new HttpModelRegistryClient({
        baseUrl: 'http://localhost:3001',
        internalToken: 'internal-secret',
        timeoutMs: 5000,
      });

      const result = await client.resolveModel({
        canonicalModelId: 'oicunt.model.embedding',
        tenantId: 'tenant-123',
        correlationId: 'corr-xyz',
      });

      expect(capturedUrl).toContain('/internal/v1/models/resolve/oicunt.model.embedding');
      expect(capturedHeaders['X-Service-Name']).toBe('embeddings');
      expect(capturedHeaders['X-Correlation-ID']).toBe('corr-xyz');
      expect(capturedHeaders['X-Tenant-ID']).toBe('tenant-123');
      expect(capturedHeaders['Authorization']).toBe('Bearer internal-secret');
      expect(result.canonicalModelId).toBe('oicunt.model.embedding');
    });

    it('maps 404 to UnsupportedModelError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'MODEL_NOT_FOUND', message: 'Model not registered' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const client = new HttpModelRegistryClient({ baseUrl: 'http://localhost:3001' });
      await expect(
        client.resolveModel({
          canonicalModelId: 'unknown-model',
          correlationId: 'corr-01',
        }),
      ).rejects.toThrow(UnsupportedModelError);
    });

    it('maps UNSUPPORTED_CAPABILITY to UnsupportedCapabilityError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'UNSUPPORTED_CAPABILITY',
              message: 'Model does not support embedding',
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const client = new HttpModelRegistryClient({ baseUrl: 'http://localhost:3001' });
      await expect(
        client.resolveModel({
          canonicalModelId: 'chat-only-model',
          correlationId: 'corr-02',
        }),
      ).rejects.toThrow(UnsupportedCapabilityError);
    });

    it('maps 503 to ModelUnavailableError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'MODEL_UNAVAILABLE', message: 'No targets online' },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const client = new HttpModelRegistryClient({ baseUrl: 'http://localhost:3001' });
      await expect(
        client.resolveModel({
          canonicalModelId: 'oicunt.model.embedding',
          correlationId: 'corr-03',
        }),
      ).rejects.toThrow(ModelUnavailableError);
    });
  });

  describe('HttpModelGatewayClient', () => {
    it('dispatches embeddings successfully and normalizes result', async () => {
      const mockVectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];

      let capturedUrl = '';
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              vectors: mockVectors,
              usage: { promptTokens: 10, totalTokens: 10 },
              targetUsed: 'tgt-1',
              providerUsed: 'openai',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const client = new HttpModelGatewayClient({
        baseUrl: 'http://localhost:3002',
        internalToken: 'internal-secret',
      });

      const result = await client.dispatchEmbeddings({
        requestId: 'req-01',
        correlationId: 'corr-01',
        canonicalModelId: 'oicunt.model.embedding',
        version: '1.0.0',
        inputs: ['hello', 'world'],
        dimensions: 3,
        eligibleTargets: [
          {
            targetId: 'tgt-1',
            provider: 'openai',
            upstreamModelId: 'text-embedding-3-small',
            priority: 1,
            weight: 100,
          },
        ],
        tenantId: 'tenant-123',
      });

      expect(capturedUrl).toContain('/internal/v1/models/dispatch');
      expect(capturedBody['canonicalModelId']).toBe('oicunt.model.embedding');
      expect(result.vectors).toHaveLength(2);
      expect(result.usage.promptTokens).toBe(10);
      expect(result.targetUsed).toBe('tgt-1');
    });

    it('maps 429 response to RateLimitedError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'RATE_LIMITED', message: 'Quota exhausted' },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const client = new HttpModelGatewayClient({ baseUrl: 'http://localhost:3002' });
      await expect(
        client.dispatchEmbeddings({
          requestId: 'req-02',
          correlationId: 'corr-02',
          canonicalModelId: 'oicunt.model.embedding',
          version: '1.0.0',
          inputs: ['hello'],
          dimensions: 1536,
          eligibleTargets: [],
          tenantId: 'tenant-123',
        }),
      ).rejects.toThrow(RateLimitedError);
    });

    it('maps 504 response to DeadlineExceededError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'DEADLINE_EXCEEDED', message: 'Upstream timed out' },
          }),
          { status: 504, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const client = new HttpModelGatewayClient({ baseUrl: 'http://localhost:3002' });
      await expect(
        client.dispatchEmbeddings({
          requestId: 'req-03',
          correlationId: 'corr-03',
          canonicalModelId: 'oicunt.model.embedding',
          version: '1.0.0',
          inputs: ['hello'],
          dimensions: 1536,
          eligibleTargets: [],
          tenantId: 'tenant-123',
        }),
      ).rejects.toThrow(DeadlineExceededError);
    });

    it('maps 502 response to ProviderExecutionFailedError', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'PROVIDER_ERROR', message: 'Provider returned 500' },
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const client = new HttpModelGatewayClient({ baseUrl: 'http://localhost:3002' });
      await expect(
        client.dispatchEmbeddings({
          requestId: 'req-04',
          correlationId: 'corr-04',
          canonicalModelId: 'oicunt.model.embedding',
          version: '1.0.0',
          inputs: ['hello'],
          dimensions: 1536,
          eligibleTargets: [],
          tenantId: 'tenant-123',
        }),
      ).rejects.toThrow(ProviderExecutionFailedError);
    });
  });
});
