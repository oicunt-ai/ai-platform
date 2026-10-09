import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EmbeddingsService } from '../../../src/service.js';
import { MockModelRegistryClient } from '../../../src/infrastructure/clients/mock-model-registry.client.js';
import { MockModelGatewayClient } from '../../../src/infrastructure/clients/mock-model-gateway.client.js';

describe('Embeddings Service HTTP API', () => {
  let service: EmbeddingsService;
  let port: number;
  let baseUrl: string;
  let registryClient: MockModelRegistryClient;
  let gatewayClient: MockModelGatewayClient;

  const validToken = 'test-internal-token-xyz';

  beforeAll(async () => {
    registryClient = new MockModelRegistryClient();
    gatewayClient = new MockModelGatewayClient();

    service = new EmbeddingsService({
      config: {
        serviceName: 'embeddings',
        version: '0.1.0',
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        internalToken: validToken,
        allowedServiceIdentities: ['knowledge', 'ai-orchestrator', 'test-runner'],
        maxBatchSize: 256,
        maxItemCharacters: 32768,
        maxBodySizeBytes: 10485760,
        shutdownTimeoutMs: 1000,
        logLevel: 'silent',
        modelRegistryUrl: 'http://localhost:3001',
        modelGatewayUrl: 'http://localhost:3002',
        downstreamTimeoutMs: 5000,
      },
      modelRegistryClient: registryClient,
      modelGatewayClient: gatewayClient,
    });

    port = await service.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await service.stop();
  });

  it('generates embeddings successfully with 200 OK', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/embeddings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
        'X-Tenant-ID': 'tenant-test-01',
        'X-Correlation-ID': 'corr-abc-123',
      },
      body: JSON.stringify({
        model: 'oicunt.model.catalog-embedding',
        inputs: ['first test text', 'second test text'],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        model: string;
        modelVersion: string;
        dimensions: number;
        embeddings: { index: number; vector: number[] }[];
        usage: { promptTokens: number; totalTokens: number };
      };
      meta: {
        requestId: string;
        correlationId: string;
        latencyMs: number;
        timestamp: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.model).toBe('oicunt.model.catalog-embedding');
    expect(body.data.modelVersion).toBe('1.0.0');
    expect(body.data.dimensions).toBe(1536);
    expect(body.data.embeddings).toHaveLength(2);
    expect(body.data.embeddings[0]?.index).toBe(0);
    expect(body.data.embeddings[0]?.vector).toHaveLength(1536);
    expect(body.data.embeddings[1]?.index).toBe(1);
    expect(body.data.embeddings[1]?.vector).toHaveLength(1536);
    expect(body.data.usage.promptTokens).toBeGreaterThan(0);

    expect(body.meta.correlationId).toBe('corr-abc-123');
    expect(body.meta.requestId).toBeDefined();
    expect(body.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects unauthenticated request with 401', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/embeddings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-ID': 'tenant-test-01',
      },
      body: JSON.stringify({
        model: 'oicunt.model.catalog-embedding',
        inputs: ['text'],
      }),
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rejects request missing X-Tenant-ID header with 400', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/embeddings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({
        model: 'oicunt.model.catalog-embedding',
        inputs: ['text'],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('rejects empty inputs array with 400 EMPTY_INPUT', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/embeddings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
        'X-Tenant-ID': 'tenant-test-01',
      },
      body: JSON.stringify({
        model: 'oicunt.model.catalog-embedding',
        inputs: [],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EMPTY_INPUT');
  });

  it('rejects empty input item with 400 EMPTY_INPUT_ITEM', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/embeddings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
        'X-Tenant-ID': 'tenant-test-01',
      },
      body: JSON.stringify({
        model: 'oicunt.model.catalog-embedding',
        inputs: ['valid', '   '],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EMPTY_INPUT_ITEM');
  });

  it('rejects unknown model with 404 UNSUPPORTED_MODEL', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/embeddings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
        'X-Tenant-ID': 'tenant-test-01',
      },
      body: JSON.stringify({
        model: 'non-existent-model',
        inputs: ['test text'],
      }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNSUPPORTED_MODEL');
  });

  it('rejects non-embedding model with 400 UNSUPPORTED_CAPABILITY', async () => {
    const response = await fetch(`${baseUrl}/internal/v1/embeddings/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
        'X-Tenant-ID': 'tenant-test-01',
      },
      body: JSON.stringify({
        model: 'chat-model-gpt4',
        inputs: ['test text'],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNSUPPORTED_CAPABILITY');
  });

  it('responds to GET /health/liveness with 200 OK', async () => {
    const response = await fetch(`${baseUrl}/health/liveness`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('embeddings');
  });

  it('responds to GET /health/readiness with 200 OK when dependencies are healthy', async () => {
    registryClient.shouldFailHealth = false;
    gatewayClient.shouldFailHealth = false;

    const response = await fetch(`${baseUrl}/health/readiness`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      dependencies: { modelRegistry: boolean; modelGateway: boolean };
    };
    expect(body.status).toBe('ready');
    expect(body.dependencies.modelRegistry).toBe(true);
    expect(body.dependencies.modelGateway).toBe(true);
  });

  it('responds to GET /health/readiness with 503 when a dependency fails', async () => {
    registryClient.shouldFailHealth = true;

    const response = await fetch(`${baseUrl}/health/readiness`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      status: string;
      dependencies: { modelRegistry: boolean; modelGateway: boolean };
    };
    expect(body.status).toBe('not_ready');
    expect(body.dependencies.modelRegistry).toBe(false);

    registryClient.shouldFailHealth = false;
  });
});
