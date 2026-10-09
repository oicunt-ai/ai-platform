import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryAuditRepository } from '../../src/infrastructure/repositories/in-memory-audit.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import {
  CreateCanonicalModelUseCase,
  CreateModelTargetUseCase,
  CreateModelVersionUseCase,
  GetModelUseCase,
  ListModelsUseCase,
  SetModelAliasUseCase,
  UpdateModelTargetStatusUseCase,
  UpdateModelVersionStatusUseCase,
  UpdateRoutingPolicyUseCase,
} from '../../src/application/use-cases/index.js';

describe('Catalog Management Use Cases & Audit Trail', () => {
  let modelRepo: InMemoryModelRepository;
  let auditRepo: InMemoryAuditRepository;
  let cache: InMemoryModelCache;

  beforeEach(() => {
    modelRepo = new InMemoryModelRepository();
    auditRepo = new InMemoryAuditRepository();
    cache = new InMemoryModelCache();
  });

  it('creates canonical model and records audit event', async () => {
    const useCase = new CreateCanonicalModelUseCase(modelRepo, auditRepo, cache);

    const model = await useCase.execute({
      id: 'oicunt.model.catalog-delta',
      displayName: 'Coding Expert',
      description: 'Specialized code generation model',
      activeVersion: 'v1.0.0',
      actorId: 'admin-user-1',
      correlationId: 'trace-1',
      reason: 'Initial model catalog entry',
    });

    expect(model.id).toBe('oicunt.model.catalog-delta');
    expect(model.activeVersion).toBe('v1.0.0');

    const audits = await auditRepo.listByEntity('canonical_model', 'oicunt.model.catalog-delta');
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('CREATE');
    expect(audits[0]?.actorId).toBe('admin-user-1');
  });

  it('creates model version, updates status, and verifies audit events', async () => {
    const createModel = new CreateCanonicalModelUseCase(modelRepo, auditRepo, cache);
    await createModel.execute({
      id: 'oicunt.model.catalog-gamma',
      displayName: 'Reasoning Engine',
      description: 'Complex logic deduction',
      activeVersion: 'v1.0.0',
      actorId: 'admin-1',
      correlationId: 'trace-1',
    });

    const createVersion = new CreateModelVersionUseCase(modelRepo, auditRepo, cache);
    const version = await createVersion.execute({
      canonicalModelId: 'oicunt.model.catalog-gamma',
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredOutputs: true,
        reasoning: true,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 64000, maxOutputTokens: 32000 },
      pricing: { costPerMillionInputTokens: 10.0, costPerMillionOutputTokens: 50.0 },
      status: 'available',
      actorId: 'admin-1',
      correlationId: 'trace-2',
    });

    expect(version.version).toBe('v1.0.0');

    const updateStatus = new UpdateModelVersionStatusUseCase(modelRepo, auditRepo, cache);
    const updated = await updateStatus.execute({
      canonicalModelId: 'oicunt.model.catalog-gamma',
      version: 'v1.0.0',
      status: 'degraded',
      actorId: 'ops-bot',
      correlationId: 'trace-3',
      reason: 'Upstream vendor rate limits high',
    });

    expect(updated.status).toBe('degraded');

    const audits = await auditRepo.listByEntity(
      'model_version',
      'oicunt.model.catalog-gamma:v1.0.0',
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]?.action).toBe('STATUS_CHANGE');
    expect(audits[0]?.actorId).toBe('ops-bot');
  });

  it('creates model target and updates target status (cordoning)', async () => {
    const createModel = new CreateCanonicalModelUseCase(modelRepo, auditRepo, cache);
    await createModel.execute({
      id: 'oicunt.model.catalog-alpha',
      displayName: 'General Intelligence',
      description: 'Desc',
      activeVersion: 'v1.0.0',
      actorId: 'admin-1',
      correlationId: 'trace-1',
    });

    const createVersion = new CreateModelVersionUseCase(modelRepo, auditRepo, cache);
    const version = await createVersion.execute({
      canonicalModelId: 'oicunt.model.catalog-alpha',
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
      limits: { contextWindowTokens: 100000, maxOutputTokens: 4000 },
      pricing: { costPerMillionInputTokens: 2.0, costPerMillionOutputTokens: 10.0 },
      actorId: 'admin-1',
      correlationId: 'trace-2',
    });

    const createTarget = new CreateModelTargetUseCase(modelRepo, auditRepo, cache);
    const target = await createTarget.execute({
      id: 'target-provider-a-1',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      modelVersionId: version.id,
      provider: 'test-provider',
      upstreamModelId: 'provider-model-alpha',
      priority: 1,
      weight: 100,
      actorId: 'admin-1',
      correlationId: 'trace-3',
    });

    expect(target.id).toBe('target-provider-a-1');

    const updateTargetStatus = new UpdateModelTargetStatusUseCase(modelRepo, auditRepo, cache);
    const cordoned = await updateTargetStatus.execute({
      canonicalModelId: 'oicunt.model.catalog-alpha',
      targetId: 'target-provider-a-1',
      status: 'maintenance',
      actorId: 'ops-1',
      correlationId: 'trace-4',
      reason: 'Regional provider maintenance window',
    });

    expect(cordoned.status).toBe('maintenance');
  });

  it('updates routing policy and verifies getModel reflects change', async () => {
    const createModel = new CreateCanonicalModelUseCase(modelRepo, auditRepo, cache);
    await createModel.execute({
      id: 'oicunt.model.catalog-alpha',
      displayName: 'General',
      description: 'Desc',
      activeVersion: 'v1.0.0',
      actorId: 'admin-1',
      correlationId: 'trace-1',
    });

    const updatePolicy = new UpdateRoutingPolicyUseCase(modelRepo, auditRepo, cache);
    await updatePolicy.execute({
      canonicalModelId: 'oicunt.model.catalog-alpha',
      strategy: 'weighted-round-robin',
      maxFallbackAttempts: 5,
      degradationBehavior: 'fallback-to-fast',
      actorId: 'admin-1',
      correlationId: 'trace-2',
    });

    const getModel = new GetModelUseCase(modelRepo);
    const detail = await getModel.execute('oicunt.model.catalog-alpha');

    expect(detail.routingPolicy.strategy).toBe('weighted-round-robin');
    expect(detail.routingPolicy.maxFallbackAttempts).toBe(5);
    expect(detail.routingPolicy.degradationBehavior).toBe('fallback-to-fast');
  });

  it('sets alias and lists all models', async () => {
    const createModel = new CreateCanonicalModelUseCase(modelRepo, auditRepo, cache);
    await createModel.execute({
      id: 'oicunt.model.catalog-alpha',
      displayName: 'General',
      description: 'Desc',
      activeVersion: 'v1.0.0',
      actorId: 'admin-1',
      correlationId: 'trace-1',
    });

    const setAlias = new SetModelAliasUseCase(modelRepo, auditRepo, cache);
    const alias = await setAlias.execute({
      canonicalModelId: 'oicunt.model.catalog-alpha',
      aliasName: 'preview',
      targetVersion: 'v1.0.0',
      actorId: 'admin-1',
      correlationId: 'trace-2',
    });

    expect(alias.aliasName).toBe('preview');

    const listModels = new ListModelsUseCase(modelRepo);
    const list = await listModels.execute();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('oicunt.model.catalog-alpha');
  });
});
