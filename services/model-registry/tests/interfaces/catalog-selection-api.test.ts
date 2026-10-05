import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CanonicalModel, ModelVersion, ModelTarget } from '../../src/domain/index.js';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryAuditRepository } from '../../src/infrastructure/repositories/in-memory-audit.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import { ModelRegistryService } from '../../src/service.js';

describe('HTTP Catalog Selection & Effort API Integration', () => {
  let service: ModelRegistryService;
  let modelRepo: InMemoryModelRepository;
  let auditRepo: InMemoryAuditRepository;
  let cache: InMemoryModelCache;
  let port: number;

  beforeAll(async () => {
    modelRepo = new InMemoryModelRepository();
    auditRepo = new InMemoryAuditRepository();
    cache = new InMemoryModelCache();

    // 1. Claude Sonnet with effort levels
    const sonnet = new CanonicalModel({
      id: 'claude-sonnet',
      displayName: 'Claude Sonnet',
      description: 'High reasoning frontier model',
      family: 'anthropic',
      activeVersion: 'v1.0.0',
    });

    const sonnetV1 = new ModelVersion({
      id: 'sonnet-ver-1',
      canonicalModelId: sonnet.id,
      version: 'v1.0.0',
      modalities: ['text', 'image'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: true,
        supportedEffortLevels: ['low', 'medium', 'high'],
        defaultEffortLevel: 'medium',
        vision: true,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 200000, maxOutputTokens: 8192 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      status: 'available',
    });

    const target1 = new ModelTarget({
      id: 'target-anthropic-direct',
      modelVersionId: sonnetV1.id,
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet-20241022',
      priority: 1,
      weight: 100,
    });

    const target2 = new ModelTarget({
      id: 'target-bedrock-backup',
      modelVersionId: sonnetV1.id,
      provider: 'bedrock',
      upstreamModelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      priority: 2,
      weight: 100,
    });

    sonnet.addVersion(sonnetV1);
    sonnet.addTarget(target1);
    sonnet.addTarget(target2);
    await modelRepo.save(sonnet);

    // 2. GPT-4o without effort levels
    const gpt = new CanonicalModel({
      id: 'gpt-4o',
      displayName: 'GPT-4o',
      description: 'Omni intelligence',
      family: 'openai',
      activeVersion: 'v1.0.0',
    });

    const gptV1 = new ModelVersion({
      id: 'gpt-ver-1',
      canonicalModelId: gpt.id,
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
      pricing: { costPerMillionInputTokens: 2.5, costPerMillionOutputTokens: 10.0 },
      status: 'available',
    });

    const gptTarget = new ModelTarget({
      id: 'target-openai-direct',
      modelVersionId: gptV1.id,
      provider: 'openai',
      upstreamModelId: 'gpt-4o-2024-08-06',
      priority: 1,
      weight: 100,
    });

    gpt.addVersion(gptV1);
    gpt.addTarget(gptTarget);
    await modelRepo.save(gpt);

    // 3. Gemini Flash in maintenance (to verify selectableOnly filtering)
    const gemini = new CanonicalModel({
      id: 'gemini-flash',
      displayName: 'Gemini Flash',
      description: 'Fast lightweight model in maintenance',
      family: 'google',
      activeVersion: 'v1.0.0',
    });

    const geminiV1 = new ModelVersion({
      id: 'gemini-ver-1',
      canonicalModelId: gemini.id,
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutputs: true,
        reasoning: false,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 1000000, maxOutputTokens: 8192 },
      pricing: { costPerMillionInputTokens: 0.1, costPerMillionOutputTokens: 0.4 },
      status: 'maintenance',
    });

    const geminiTarget = new ModelTarget({
      id: 'target-google-direct',
      modelVersionId: geminiV1.id,
      provider: 'google',
      upstreamModelId: 'gemini-1.5-flash',
      priority: 1,
      weight: 100,
    });

    gemini.addVersion(geminiV1);
    gemini.addTarget(geminiTarget);
    await modelRepo.save(gemini);

    service = new ModelRegistryService({
      modelRepository: modelRepo,
      auditRepository: auditRepo,
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
          enabled: false,
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

  it('GET /internal/v1/catalog defaults to selectableOnly=true when parameter is omitted', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/catalog`, {
      headers: {
        'x-service-name': 'ai-orchestrator',
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: Array<{
        id: string;
        displayName: string;
        family: string;
        isSelectable: boolean;
        capabilities: { reasoning: boolean; supportedEffortLevels?: string[] };
      }>;
    };

    expect(json.success).toBe(true);
    // Omitting selectableOnly must default to selectableOnly=true (only 2 selectable models returned)
    expect(json.data).toHaveLength(2);
    expect(json.data.map((m) => m.id)).toEqual(['claude-sonnet', 'gpt-4o']);
    expect(json.data.every((m) => m.isSelectable)).toBe(true);

    const sonnet = json.data.find((m) => m.id === 'claude-sonnet')!;
    expect(sonnet).toBeDefined();
    expect(sonnet.displayName).toBe('Claude Sonnet');
    expect(sonnet.family).toBe('anthropic');
    expect(sonnet.capabilities.reasoning).toBe(true);
    expect(sonnet.capabilities.supportedEffortLevels).toEqual(['low', 'medium', 'high']);

    // Ensure raw target info is not present
    expect((sonnet as unknown as Record<string, unknown>)['eligibleTargets']).toBeUndefined();
  });

  it('GET /internal/v1/catalog?selectableOnly=true returns only available/degraded models', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/catalog?selectableOnly=true`, {
      headers: {
        'x-service-name': 'ai-orchestrator',
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; isSelectable: boolean }>;
    };
    expect(json.data).toHaveLength(2);
    expect(json.data.map((m) => m.id)).toEqual(['claude-sonnet', 'gpt-4o']);
    expect(json.data.every((m) => m.isSelectable)).toBe(true);
  });

  it('GET /internal/v1/catalog?selectableOnly=false includes maintenance and non-selectable models', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/catalog?selectableOnly=false`, {
      headers: {
        'x-service-name': 'ai-orchestrator',
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; isSelectable: boolean; status: string }>;
    };
    expect(json.data).toHaveLength(3);
    const geminiEntry = json.data.find((m) => m.id === 'gemini-flash');
    expect(geminiEntry).toBeDefined();
    expect(geminiEntry?.isSelectable).toBe(false);
    expect(geminiEntry?.status).toBe('maintenance');
  });

  it('GET /internal/v1/catalog?family=openai filters catalog by family', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/internal/v1/catalog?family=openai`, {
      headers: {
        'x-service-name': 'ai-orchestrator',
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; family: string }>;
    };
    expect(json.data).toHaveLength(1);
    expect(json.data[0]?.id).toBe('gpt-4o');
    expect(json.data[0]?.family).toBe('openai');
  });

  it('GET /internal/v1/models/resolve/:id?effort=high resolves with validated effort', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/claude-sonnet?effort=high`,
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
        canonicalModelId: string;
        effort: string;
        eligibleTargets: Array<{ targetId: string }>;
      };
    };
    expect(json.data.canonicalModelId).toBe('claude-sonnet');
    expect(json.data.effort).toBe('high');
    expect(json.data.eligibleTargets).toHaveLength(2);
  });

  it('GET /internal/v1/models/resolve/:id?effort=extreme rejects unsupported effort with 400 UNSUPPORTED_EFFORT_LEVEL', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/claude-sonnet?effort=extreme`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(json.error.code).toBe('UNSUPPORTED_EFFORT_LEVEL');
    expect(json.error.message).toContain('extreme');
  });

  it('GET /internal/v1/models/resolve/:id?effort=high rejects effort on non-reasoning model with 400', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/gpt-4o?effort=high`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );

    expect(res.status).toBe(400);
    const json = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(json.error.code).toBe('UNSUPPORTED_EFFORT_LEVEL');
  });

  it('PUT /internal/v1/models/:id/targets/:targetId/status cordons target and subsequent resolution reflects change', async () => {
    // Admin cordons target 1
    const cordonRes = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/claude-sonnet/targets/target-anthropic-direct/status`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-service-name': 'ai-platform-admin',
          'x-actor-id': 'admin-ops',
          'x-change-reason': 'Vendor rate limit hit, routing to Bedrock fallback',
        },
        body: JSON.stringify({ status: 'maintenance' }),
      },
    );

    expect(cordonRes.status).toBe(200);

    // Subsequent resolution for BILLY automatically serves the fallback target
    const resolveRes = await fetch(
      `http://127.0.0.1:${port}/internal/v1/models/resolve/claude-sonnet`,
      {
        headers: {
          'x-service-name': 'ai-orchestrator',
        },
      },
    );

    expect(resolveRes.status).toBe(200);
    const resolveJson = (await resolveRes.json()) as {
      data: { eligibleTargets: Array<{ targetId: string; provider: string }> };
    };
    expect(resolveJson.data.eligibleTargets).toHaveLength(1);
    expect(resolveJson.data.eligibleTargets[0]?.targetId).toBe('target-bedrock-backup');
    expect(resolveJson.data.eligibleTargets[0]?.provider).toBe('bedrock');
  });
});
