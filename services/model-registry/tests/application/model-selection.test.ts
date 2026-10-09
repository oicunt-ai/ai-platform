import { beforeEach, describe, expect, it } from 'vitest';
import {
  CanonicalModel,
  ModelVersion,
  ModelTarget,
  UnsupportedEffortError,
  VersionNotFoundError,
} from '../../src/domain/index.js';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import { GetModelCatalogUseCase } from '../../src/application/use-cases/get-model-catalog.use-case.js';
import { ResolveModelUseCase } from '../../src/application/use-cases/resolve-model.use-case.js';

describe('Model Selection, Catalog & Effort Capabilities Specification', () => {
  let repository: InMemoryModelRepository;
  let cache: InMemoryModelCache;
  let catalogUseCase: GetModelCatalogUseCase;
  let resolveUseCase: ResolveModelUseCase;

  beforeEach(async () => {
    repository = new InMemoryModelRepository();
    cache = new InMemoryModelCache();
    catalogUseCase = new GetModelCatalogUseCase(repository);
    resolveUseCase = new ResolveModelUseCase(repository, cache);

    // 1. Catalog Model Alpha (Reasoning model supporting low, medium, high effort)
    const catalogAlpha = new CanonicalModel({
      id: 'oicunt.model.catalog-alpha',
      displayName: 'Catalog Model Alpha',
      description: 'High-intelligence frontier reasoning model',
      family: 'test-provider',
      activeVersion: 'v1.0.0',
    });

    const alphaV1 = new ModelVersion({
      id: 'alpha-v1-uuid',
      canonicalModelId: catalogAlpha.id,
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

    // Target 1: primary provider route
    const alphaTarget1 = new ModelTarget({
      id: 'target-provider-a-direct',
      modelVersionId: alphaV1.id,
      provider: 'test-provider',
      upstreamModelId: 'provider-model-alpha-v1',
      priority: 1,
      weight: 100,
      region: 'us-east-1',
    });

    // Target 2: Fallback via AWS Bedrock (provider replacement / resilience)
    const alphaTarget2 = new ModelTarget({
      id: 'target-bedrock-fallback',
      modelVersionId: alphaV1.id,
      provider: 'bedrock',
      upstreamModelId: 'provider-b.model-alpha-v1',
      priority: 2,
      weight: 100,
      region: 'us-east-1',
    });

    catalogAlpha.addVersion(alphaV1);
    catalogAlpha.addTarget(alphaTarget1);
    catalogAlpha.addTarget(alphaTarget2);
    await repository.save(catalogAlpha);

    // 2. Catalog Model Beta (General model, reasoning=false, no effort levels)
    const gpt4o = new CanonicalModel({
      id: 'oicunt.model.catalog-beta',
      displayName: 'Catalog Model Beta',
      description: 'Versatile multimodal flagship model',
      family: 'openai',
      activeVersion: 'v1.0.0',
    });

    const gpt4oV1 = new ModelVersion({
      id: 'gpt4o-v1-uuid',
      canonicalModelId: gpt4o.id,
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
      modelVersionId: gpt4oV1.id,
      provider: 'openai',
      upstreamModelId: 'provider-model-beta-2024-08-06',
      priority: 1,
      weight: 100,
    });

    gpt4o.addVersion(gpt4oV1);
    gpt4o.addTarget(gptTarget);
    await repository.save(gpt4o);

    // 3. Catalog Model Gamma (Fast model in maintenance)
    const geminiFlash = new CanonicalModel({
      id: 'oicunt.model.catalog-gamma',
      displayName: 'Catalog Model Gamma',
      description: 'Ultra fast and lightweight model',
      family: 'google',
      activeVersion: 'v1.0.0',
    });

    const geminiV1 = new ModelVersion({
      id: 'gemini-v1-uuid',
      canonicalModelId: geminiFlash.id,
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

    geminiFlash.addVersion(geminiV1);
    geminiFlash.addTarget(geminiTarget);
    await repository.save(geminiFlash);
  });

  describe('Dynamic Model Catalog Presentation', () => {
    it('defaults to selectableOnly=true and returns rich catalog entries without exposing provider-specific targets or credentials', async () => {
      // Default execution without options must apply selectableOnly=true (only available/degraded models)
      const defaultCatalog = await catalogUseCase.execute();
      expect(defaultCatalog).toHaveLength(2);
      expect(defaultCatalog.map((m) => m.id)).toEqual([
        'oicunt.model.catalog-beta',
        'oicunt.model.catalog-alpha',
      ]);

      // With selectableOnly=false, all models including maintenance models are returned
      const allCatalog = await catalogUseCase.execute({ selectableOnly: false });
      expect(allCatalog).toHaveLength(3);

      const alphaEntry = allCatalog.find((m) => m.id === 'oicunt.model.catalog-alpha')!;
      expect(alphaEntry).toBeDefined();
      expect(alphaEntry.displayName).toBe('Catalog Model Alpha');
      expect(alphaEntry.family).toBe('test-provider');
      expect(alphaEntry.activeVersion).toBe('v1.0.0');
      expect(alphaEntry.isSelectable).toBe(true);
      expect(alphaEntry.capabilities.reasoning).toBe(true);
      expect(alphaEntry.capabilities.supportedEffortLevels).toEqual(['low', 'medium', 'high']);
      expect(alphaEntry.capabilities.defaultEffortLevel).toBe('medium');

      // Crucial: Provider targets and upstream IDs are strictly omitted from the catalog
      expect((alphaEntry as unknown as Record<string, unknown>)['eligibleTargets']).toBeUndefined();
      expect((alphaEntry as unknown as Record<string, unknown>)['upstreamModelId']).toBeUndefined();
    });

    it('filters catalog by selectableOnly to omit models in maintenance/deprecated state', async () => {
      const allEntries = await catalogUseCase.execute({ selectableOnly: false });
      expect(allEntries).toHaveLength(3);
      expect(allEntries.find((m) => m.id === 'oicunt.model.catalog-gamma')?.isSelectable).toBe(
        false,
      );

      const selectableEntries = await catalogUseCase.execute({ selectableOnly: true });
      expect(selectableEntries).toHaveLength(2);
      expect(selectableEntries.map((m) => m.id)).toEqual([
        'oicunt.model.catalog-beta',
        'oicunt.model.catalog-alpha',
      ]);
    });

    it('filters catalog by family category', async () => {
      const providerModels = await catalogUseCase.execute({ family: 'test-provider' });
      expect(providerModels).toHaveLength(1);
      expect(providerModels[0]?.id).toBe('oicunt.model.catalog-alpha');

      const openaiModels = await catalogUseCase.execute({ family: 'openai' });
      expect(openaiModels).toHaveLength(1);
      expect(openaiModels[0]?.id).toBe('oicunt.model.catalog-beta');
    });

    it('throws VersionNotFoundError when model activeVersion cannot be found (removes silent fallback)', async () => {
      const corruptedModel = new CanonicalModel({
        id: 'oicunt.model.corrupted',
        displayName: 'Corrupted Model',
        description: 'Model with missing active version in versions list',
        family: 'test',
        activeVersion: 'v2.0.0', // Does not exist in versions
      });
      const v1 = new ModelVersion({
        id: 'corrupted-v1-uuid',
        canonicalModelId: corruptedModel.id,
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
        limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
        pricing: { costPerMillionInputTokens: 1.0, costPerMillionOutputTokens: 2.0 },
        status: 'available',
      });
      corruptedModel.addVersion(v1);
      await repository.save(corruptedModel);

      await expect(catalogUseCase.execute()).rejects.toThrowError(VersionNotFoundError);
    });
  });

  describe('Reasoning Effort Capabilities & Parameter Flow', () => {
    it('resolves model with explicitly requested valid effort level', async () => {
      const resolution = await resolveUseCase.execute({
        canonicalModelId: 'oicunt.model.catalog-alpha',
        effort: 'high',
        correlationId: 'test-trace-1',
      });

      expect(resolution.canonicalModelId).toBe('oicunt.model.catalog-alpha');
      expect(resolution.effort).toBe('high');
      expect(resolution.capabilities.reasoning).toBe(true);
      expect(resolution.capabilities.supportedEffortLevels).toContain('high');
    });

    it('assigns model default effort level when effort is omitted on a reasoning model', async () => {
      const resolution = await resolveUseCase.execute({
        canonicalModelId: 'oicunt.model.catalog-alpha',
        correlationId: 'test-trace-2',
      });

      expect(resolution.canonicalModelId).toBe('oicunt.model.catalog-alpha');
      // Defaults to configured defaultEffortLevel ('medium')
      expect(resolution.effort).toBe('medium');
    });

    it('rejects effort parameter on models that do not support reasoning with UNSUPPORTED_EFFORT_LEVEL', async () => {
      await expect(
        resolveUseCase.execute({
          canonicalModelId: 'oicunt.model.catalog-beta',
          effort: 'high',
          correlationId: 'test-trace-3',
        }),
      ).rejects.toThrowError(UnsupportedEffortError);

      try {
        await resolveUseCase.execute({
          canonicalModelId: 'oicunt.model.catalog-beta',
          effort: 'high',
          correlationId: 'test-trace-3',
        });
      } catch (err: unknown) {
        expect((err as UnsupportedEffortError).code).toBe('UNSUPPORTED_EFFORT_LEVEL');
        expect((err as UnsupportedEffortError).message).toContain(
          'does not support reasoning effort',
        );
      }
    });

    it('rejects unsupported effort levels on reasoning models with UNSUPPORTED_EFFORT_LEVEL', async () => {
      await expect(
        resolveUseCase.execute({
          canonicalModelId: 'oicunt.model.catalog-alpha',
          effort: 'ultra-maximum',
          correlationId: 'test-trace-4',
        }),
      ).rejects.toThrowError(UnsupportedEffortError);

      try {
        await resolveUseCase.execute({
          canonicalModelId: 'oicunt.model.catalog-alpha',
          effort: 'ultra-maximum',
          correlationId: 'test-trace-4',
        });
      } catch (err: unknown) {
        expect((err as UnsupportedEffortError).code).toBe('UNSUPPORTED_EFFORT_LEVEL');
        expect((err as UnsupportedEffortError).message).toContain(
          'Supported levels: [low, medium, high]',
        );
      }
    });
  });

  describe('Multiple Provider Targets & Seamless Provider Replacement', () => {
    it('returns multiple ordered eligible provider targets for a single user-facing model', async () => {
      const resolution = await resolveUseCase.execute({
        canonicalModelId: 'oicunt.model.catalog-alpha',
        correlationId: 'test-trace-5',
      });

      expect(resolution.eligibleTargets).toHaveLength(2);
      // Priority 1 target is first
      expect(resolution.eligibleTargets[0]?.targetId).toBe('target-provider-a-direct');
      expect(resolution.eligibleTargets[0]?.provider).toBe('test-provider');
      expect(resolution.eligibleTargets[0]?.priority).toBe(1);

      // Priority 2 fallback target is second
      expect(resolution.eligibleTargets[1]?.targetId).toBe('target-bedrock-fallback');
      expect(resolution.eligibleTargets[1]?.provider).toBe('bedrock');
      expect(resolution.eligibleTargets[1]?.priority).toBe(2);
    });

    it('seamlessly reroutes to fallback provider target when primary target is cordoned (maintenance)', async () => {
      const model = (await repository.findById('oicunt.model.catalog-alpha'))!;

      // Cordon the primary target (simulate upstream outage or quota exhaustion)
      model.updateTargetStatus('target-provider-a-direct', 'maintenance');
      await repository.save(model);
      await cache.invalidateModel('oicunt.model.catalog-alpha');

      const resolution = await resolveUseCase.execute({
        canonicalModelId: 'oicunt.model.catalog-alpha',
        correlationId: 'test-trace-6',
      });

      // User-facing model ID remains stable as 'oicunt.model.catalog-alpha'! BILLY requires NO changes!
      expect(resolution.canonicalModelId).toBe('oicunt.model.catalog-alpha');
      expect(resolution.eligibleTargets).toHaveLength(1);
      expect(resolution.eligibleTargets[0]?.targetId).toBe('target-bedrock-fallback');
      expect(resolution.eligibleTargets[0]?.provider).toBe('bedrock');
      expect(resolution.eligibleTargets[0]?.upstreamModelId).toBe('provider-b.model-alpha-v1');
    });
  });
});
