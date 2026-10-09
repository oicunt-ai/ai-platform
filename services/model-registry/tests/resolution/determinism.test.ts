import { describe, expect, it } from 'vitest';
import { CanonicalModel, ModelVersion, ModelTarget } from '../../src/domain/index.js';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import { ResolveModelUseCase } from '../../src/application/use-cases/resolve-model.use-case.js';

describe('Resolution Determinism & Fallback Invariant Tests', () => {
  it('guarantees deterministic target ordering across 50 repeated executions', async () => {
    const repository = new InMemoryModelRepository();
    const cache = new InMemoryModelCache();
    const useCase = new ResolveModelUseCase(repository, cache);

    const model = new CanonicalModel({
      id: 'oicunt.model.catalog-alpha',
      displayName: 'General Intelligence',
      description: 'Desc',
      activeVersion: 'v1.0.0',
    });

    const v1 = new ModelVersion({
      id: 'ver-1',
      canonicalModelId: model.id,
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
      limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      status: 'available',
    });

    // Add 5 targets with intentional out-of-order priority, weight, and IDs
    // Target A: priority 2, weight 50
    // Target B: priority 1, weight 80, id 'target-b'
    // Target C: priority 1, weight 100, id 'target-c' (should be 1st because weight 100 > 80)
    // Target D: priority 1, weight 80, id 'target-a' (should be 2nd because 'target-a' < 'target-b')
    // Target E: priority 3, weight 100
    const targetA = new ModelTarget({
      id: 'target-2-p2-w50',
      modelVersionId: v1.id,
      provider: 'openai',
      upstreamModelId: 'provider-model-beta',
      priority: 2,
      weight: 50,
    });

    const targetB = new ModelTarget({
      id: 'target-b-p1-w80',
      modelVersionId: v1.id,
      provider: 'test-provider',
      upstreamModelId: 'provider-model-alpha',
      priority: 1,
      weight: 80,
    });

    const targetC = new ModelTarget({
      id: 'target-c-p1-w100',
      modelVersionId: v1.id,
      provider: 'test-provider',
      upstreamModelId: 'provider-model-alpha-fast',
      priority: 1,
      weight: 100,
    });

    const targetD = new ModelTarget({
      id: 'target-a-p1-w80',
      modelVersionId: v1.id,
      provider: 'google',
      upstreamModelId: 'gemini-1.5-pro',
      priority: 1,
      weight: 80,
    });

    const targetE = new ModelTarget({
      id: 'target-3-p3-w100',
      modelVersionId: v1.id,
      provider: 'bedrock',
      upstreamModelId: 'provider-b.model-v2',
      priority: 3,
      weight: 100,
    });

    // Also add a cordoned (maintenance) target that must NEVER be returned
    const targetMaint = new ModelTarget({
      id: 'target-maintenance-never-return',
      modelVersionId: v1.id,
      provider: 'custom',
      upstreamModelId: 'internal-experimental',
      priority: 1,
      weight: 100,
      status: 'maintenance',
    });

    // Also add a deprecated target that must NEVER be returned
    const targetDep = new ModelTarget({
      id: 'target-deprecated-never-return',
      modelVersionId: v1.id,
      provider: 'openai',
      upstreamModelId: 'gpt-3.5-turbo',
      priority: 1,
      weight: 100,
      status: 'deprecated',
    });

    model.addVersion(v1);
    model.addTarget(targetA);
    model.addTarget(targetB);
    model.addTarget(targetC);
    model.addTarget(targetD);
    model.addTarget(targetE);
    model.addTarget(targetMaint);
    model.addTarget(targetDep);

    await repository.save(model);

    // Expected deterministic order:
    // 1. target-c-p1-w100 (P1, W100)
    // 2. target-a-p1-w80  (P1, W80, id 'target-a' before 'target-b')
    // 3. target-b-p1-w80  (P1, W80, id 'target-b')
    // 4. target-2-p2-w50  (P2, W50)
    // 5. target-3-p3-w100 (P3, W100)
    const expectedOrder = [
      'target-c-p1-w100',
      'target-a-p1-w80',
      'target-b-p1-w80',
      'target-2-p2-w50',
      'target-3-p3-w100',
    ];

    for (let i = 0; i < 50; i++) {
      // Clear cache between calls to test repository query determinism
      await cache.clear();

      const response = await useCase.execute({
        canonicalModelId: 'oicunt.model.catalog-alpha',
        correlationId: `run-${i}`,
      });

      const actualOrder = response.eligibleTargets.map((t) => t.targetId);
      expect(actualOrder).toEqual(expectedOrder);

      // Verify maintenance and deprecated targets are NEVER present
      expect(actualOrder).not.toContain('target-maintenance-never-return');
      expect(actualOrder).not.toContain('target-deprecated-never-return');
    }
  });

  it('guarantees deterministic failover promotion when primary targets are cordoned', async () => {
    const repository = new InMemoryModelRepository();
    const cache = new InMemoryModelCache();
    const useCase = new ResolveModelUseCase(repository, cache);

    const model = new CanonicalModel({
      id: 'oicunt.model.catalog-alpha',
      displayName: 'General Intelligence',
      description: 'Desc',
      activeVersion: 'v1.0.0',
    });

    const v1 = new ModelVersion({
      id: 'ver-1',
      canonicalModelId: model.id,
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
      limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      status: 'available',
    });

    const primary = new ModelTarget({
      id: 'primary-target',
      modelVersionId: v1.id,
      provider: 'test-provider',
      upstreamModelId: 'provider-model-alpha',
      priority: 1,
      weight: 100,
    });

    const secondary = new ModelTarget({
      id: 'secondary-target',
      modelVersionId: v1.id,
      provider: 'openai',
      upstreamModelId: 'provider-model-beta',
      priority: 2,
      weight: 100,
    });

    model.addVersion(v1);
    model.addTarget(primary);
    model.addTarget(secondary);
    await repository.save(model);

    // Initial: primary is at index 0
    const res1 = await useCase.execute({
      canonicalModelId: 'oicunt.model.catalog-alpha',
      correlationId: 'trace-1',
    });
    expect(res1.eligibleTargets[0]?.targetId).toBe('primary-target');

    // Cordon primary
    model.updateTargetStatus('primary-target', 'maintenance');
    await repository.save(model);
    await cache.clear();

    // After cordoning: secondary is promoted to index 0 deterministically
    const res2 = await useCase.execute({
      canonicalModelId: 'oicunt.model.catalog-alpha',
      correlationId: 'trace-2',
    });
    expect(res2.eligibleTargets).toHaveLength(1);
    expect(res2.eligibleTargets[0]?.targetId).toBe('secondary-target');
  });
});
