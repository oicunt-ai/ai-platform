import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CanonicalModel, ModelVersion, ModelTarget, ModelAlias } from '../../src/domain/index.js';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import { ModelRegistryService } from '../../src/service.js';

describe('HTTP Resolution API Integration', () => {
  let service: ModelRegistryService;
  let repository: InMemoryModelRepository;
  let cache: InMemoryModelCache;
  let port: number;

  beforeAll(async () => {
    repository = new InMemoryModelRepository();
    cache = new InMemoryModelCache();

    // Seed canonical model
    const model = new CanonicalModel({
      id: 'oicunt.model.catalog-alpha',
      displayName: 'General Intelligence',
      description: 'Conversational frontier model',
      activeVersion: 'v1.0.0',
    });

    const v1 = new ModelVersion({
      id: 'ver-uuid-1',
      canonicalModelId: model.id,
      version: 'v1.0.0',
      modalities: ['text', 'image'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: false,
        vision: true,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      status: 'available',
    });

    const v2 = new ModelVersion({
      id: 'ver-uuid-2',
      canonicalModelId: model.id,
      version: 'v2.0.0',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: true,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 200000, maxOutputTokens: 8192 },
      pricing: { costPerMillionInputTokens: 5.0, costPerMillionOutputTokens: 25.0 },
      status: 'available',
    });

    const target1 = new ModelTarget({
      id: 'target-provider-a-alpha',
      modelVersionId: v1.id,
      provider: 'test-provider',
      upstreamModelId: 'provider-model-alpha',
      priority: 1,
      weight: 100,
    });

    const target2 = new ModelTarget({
      id: 'target-openai-gpt4o',
      modelVersionId: v1.id,
      provider: 'openai',
      upstreamModelId: 'provider-model-beta',
      priority: 2,
      weight: 100,
    });

    const target3 = new ModelTarget({
      id: 'target-gemini-v2',
      modelVersionId: v2.id,
      provider: 'google',
      upstreamModelId: 'gemini-1.5-pro',
      priority: 1,
      weight: 100,
    });

    model.addVersion(v1);
    model.addVersion(v2);
    model.addTarget(target1);
    model.addTarget(target2);
    model.addTarget(target3);
    model.setAlias(
      new ModelAlias({
        canonicalModelId: model.id,
        aliasName: 'latest',
        targetVersion: 'v2.0.0',
      }),
    );

    await repository.save(model);

    service = new ModelRegistryService({
      modelRepository: repository,
      cache,
      config: {
        serviceName: 'model-registry',
        environment: 'test',
        port: 0,
        host: '127.0.0.1',
        version: '0.1.0',
        shutdownTimeoutMs: 1000,
        enableTelemetry: false,
        logLevel: 'silent',
        database: {
          host: 'localhost',
          port: 5432,
          database: 'test',
          user: 'postgres',
          ssl: false,
          maxConnections: 1,
          idleTimeoutMs: 1000,
          connectionTimeoutMs: 1000,
        },
        cache: {
          enabled: true,
          defaultTtlSeconds: 60,
          staleTtlSeconds: 300,
        },
        allowedServiceIdentities: ['ai-orchestrator', 'model-gateway', 'ai-platform-admin'],
        maxBodySizeBytes: 1048576,
      },
    });

    port = await service.start();
  });

  afterAll(async () => {
    await service.stop();
  });

  it('rejects resolution requests without X-Service-Name with 401 UNAUTHORIZED', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/oicunt.model.catalog-alpha`,
    );

    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('GET /internal/v1/models/resolve/:id resolves active model targets and reflects correlation ID', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/oicunt.model.catalog-alpha`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
          'x-correlation-id': 'custom-trace-123',
        },
      },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('x-correlation-id')).toBe('custom-trace-123');

    const json = (await res.json()) as {
      success: boolean;
      data: {
        canonicalModelId: string;
        version: string;
        eligibleTargets: Array<{ targetId: string }>;
        routingPolicy: { strategy: string };
      };
    };
    expect(json.success).toBe(true);
    expect(json.data.canonicalModelId).toBe('oicunt.model.catalog-alpha');
    expect(json.data.version).toBe('v1.0.0');
    expect(json.data.eligibleTargets).toHaveLength(2);
    expect(json.data.eligibleTargets[0]?.targetId).toBe('target-provider-a-alpha');
    expect(json.data.routingPolicy.strategy).toBe('priority-fallback');
  });

  it('GET /internal/v1/models/resolve/:id?version=latest resolves via alias pointer', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/oicunt.model.catalog-alpha?version=latest`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: {
        version: string;
        eligibleTargets: Array<{ targetId: string }>;
      };
    };
    expect(json.data.version).toBe('v2.0.0');
    expect(json.data.eligibleTargets).toHaveLength(1);
    expect(json.data.eligibleTargets[0]?.targetId).toBe('target-gemini-v2');
  });

  it('returns 404 MODEL_NOT_FOUND when model is unregistered', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/oicunt.model.unknown-id`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );

    expect(res.status).toBe(404);
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('MODEL_NOT_FOUND');
  });

  it('returns 400 VALIDATION_FAILED when model ID format is invalid', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/INVALID_UPPERCASE!`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 503 MODEL_IN_MAINTENANCE when version is set to maintenance', async () => {
    const model = (await repository.findById('oicunt.model.catalog-alpha'))!;
    model.updateVersionStatus('v1.0.0', 'maintenance');
    await repository.save(model);
    await cache.clear();

    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/oicunt.model.catalog-alpha`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );

    expect(res.status).toBe(503);
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(json.error.code).toBe('MODEL_IN_MAINTENANCE');
  });
});
