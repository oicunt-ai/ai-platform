import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalModelId } from '@oicunt-ai/model-types';
import {
  CanonicalModel,
  ModelVersion,
  ModelTarget,
  ModelAlias,
  ModelNotFoundError,
  ModelInMaintenanceError,
  ModelDeprecatedError,
  NoEligibleTargetsError,
  ModelValidationError,
} from '../../src/domain/index.js';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import { ResolveModelUseCase } from '../../src/application/use-cases/resolve-model.use-case.js';

describe('ResolveModelUseCase - 7-Step Resolution Pipeline', () => {
  let repository: InMemoryModelRepository;
  let cache: InMemoryModelCache;
  let useCase: ResolveModelUseCase;

  beforeEach(() => {
    repository = new InMemoryModelRepository();
    cache = new InMemoryModelCache();
    useCase = new ResolveModelUseCase(repository, cache);
  });

  const seedModel = async () => {
    const model = new CanonicalModel({
      id: 'oicunt.model.general',
      displayName: 'General Intelligence',
      description: 'Production frontier model',
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

    // Targets for v1: primary and secondary fallback
    const target1 = new ModelTarget({
      id: 'target-anthropic-primary',
      modelVersionId: v1.id,
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet',
      priority: 1,
      weight: 100,
      region: 'us-east-1',
    });

    const target2 = new ModelTarget({
      id: 'target-openai-fallback',
      modelVersionId: v1.id,
      provider: 'openai',
      upstreamModelId: 'gpt-4o',
      priority: 2,
      weight: 100,
      region: 'us-east-1',
    });

    // Target for v2
    const target3 = new ModelTarget({
      id: 'target-google-v2',
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
    return { model, v1, v2, target1, target2, target3 };
  };

  it('Step 1: rejects invalid canonical model ID pattern or missing correlation ID', async () => {
    await expect(
      useCase.execute({
        canonicalModelId: 'INVALID_UPPERCASE!' as unknown as CanonicalModelId,
        correlationId: 'corr-1',
      }),
    ).rejects.toThrowError(ModelValidationError);

    await expect(
      useCase.execute({
        canonicalModelId: 'oicunt.model.general',
        correlationId: '',
      }),
    ).rejects.toThrowError(ModelValidationError);
  });

  it('Step 2: throws ModelNotFoundError when canonical model does not exist', async () => {
    await expect(
      useCase.execute({
        canonicalModelId: 'oicunt.model.non-existent',
        correlationId: 'corr-1',
      }),
    ).rejects.toThrowError(ModelNotFoundError);
  });

  it('Step 3: resolves active version when version is omitted', async () => {
    await seedModel();

    const response = await useCase.execute({
      canonicalModelId: 'oicunt.model.general',
      correlationId: 'corr-1',
    });

    expect(response.canonicalModelId).toBe('oicunt.model.general');
    expect(response.version).toBe('v1.0.0');
    expect(response.eligibleTargets).toHaveLength(2);
    expect(response.eligibleTargets[0]?.targetId).toBe('target-anthropic-primary');
    expect(response.eligibleTargets[1]?.targetId).toBe('target-openai-fallback');
  });

  it('Step 3: resolves alias pointer deterministically', async () => {
    await seedModel();

    const response = await useCase.execute({
      canonicalModelId: 'oicunt.model.general',
      version: 'latest',
      correlationId: 'corr-1',
    });

    expect(response.version).toBe('v2.0.0');
    expect(response.eligibleTargets).toHaveLength(1);
    expect(response.eligibleTargets[0]?.targetId).toBe('target-google-v2');
  });

  it('Step 4: throws ModelInMaintenanceError if resolved version is in maintenance', async () => {
    const { model } = await seedModel();
    model.updateVersionStatus('v1.0.0', 'maintenance');
    await repository.save(model);

    await expect(
      useCase.execute({
        canonicalModelId: 'oicunt.model.general',
        correlationId: 'corr-1',
      }),
    ).rejects.toThrowError(ModelInMaintenanceError);
  });

  it('Step 4: throws ModelDeprecatedError if resolved version is deprecated', async () => {
    const { model } = await seedModel();
    model.updateVersionStatus('v1.0.0', 'deprecated');
    await repository.save(model);

    await expect(
      useCase.execute({
        canonicalModelId: 'oicunt.model.general',
        correlationId: 'corr-1',
      }),
    ).rejects.toThrowError(ModelDeprecatedError);
  });

  it('Step 5: throws NoEligibleTargetsError when all targets are cordoned (maintenance)', async () => {
    const { model } = await seedModel();
    model.updateTargetStatus('target-anthropic-primary', 'maintenance');
    model.updateTargetStatus('target-openai-fallback', 'maintenance');
    await repository.save(model);

    await expect(
      useCase.execute({
        canonicalModelId: 'oicunt.model.general',
        correlationId: 'corr-1',
      }),
    ).rejects.toThrowError(NoEligibleTargetsError);
  });

  it('Step 5 & 7: caches resolution and returns cached response on second call', async () => {
    await seedModel();

    const first = await useCase.execute({
      canonicalModelId: 'oicunt.model.general',
      correlationId: 'corr-1',
    });

    // Modify repository directly
    const model = (await repository.findById('oicunt.model.general'))!;
    model.updateTargetStatus('target-anthropic-primary', 'maintenance');
    await repository.save(model);

    // Second call hits cache, so still returns cached response
    const second = await useCase.execute({
      canonicalModelId: 'oicunt.model.general',
      correlationId: 'corr-2',
    });

    expect(second.resolvedAt).toBe(first.resolvedAt);

    // Invalidate cache
    await cache.invalidateModel('oicunt.model.general');

    // Third call hits repository and reflects target-anthropic-primary in maintenance
    const third = await useCase.execute({
      canonicalModelId: 'oicunt.model.general',
      correlationId: 'corr-3',
    });

    expect(third.eligibleTargets).toHaveLength(1);
    expect(third.eligibleTargets[0]?.targetId).toBe('target-openai-fallback');
  });
});
