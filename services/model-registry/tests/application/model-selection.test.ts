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

    // 1. Claude Sonnet (Reasoning model supporting low, medium, high effort)
    const claudeSonnet = new CanonicalModel({
      id: 'claude-sonnet',
      displayName: 'Claude Sonnet',
      description: 'High-intelligence frontier reasoning model',
      family: 'anthropic',
      activeVersion: 'v1.0.0',
    });

    const sonnetV1 = new ModelVersion({
      id: 'sonnet-v1-uuid',
      canonicalModelId: claudeSonnet.id,
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

    // Target 1: Primary Anthropic direct API
    const sonnetTarget1 = new ModelTarget({
      id: 'target-anthropic-direct',
      modelVersionId: sonnetV1.id,
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet-20241022',
      priority: 1,
      weight: 100,
      region: 'us-east-1',
    });

    // Target 2: Fallback via AWS Bedrock (provider replacement / resilience)
    const sonnetTarget2 = new ModelTarget({
      id: 'target-bedrock-fallback',
      modelVersionId: sonnetV1.id,
      provider: 'bedrock',
      upstreamModelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      priority: 2,
      weight: 100,
      region: 'us-east-1',
    });

    claudeSonnet.addVersion(sonnetV1);
    claudeSonnet.addTarget(sonnetTarget1);
    claudeSonnet.addTarget(sonnetTarget2);
    await repository.save(claudeSonnet);

    // 2. GPT-4o (General model, reasoning=false, no effort levels)
    const gpt4o = new CanonicalModel({
      id: 'gpt-4o',
      displayName: 'GPT-4o',
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
      upstreamModelId: 'gpt-4o-2024-08-06',
      priority: 1,
      weight: 100,
    });

    gpt4o.addVersion(gpt4oV1);
    gpt4o.addTarget(gptTarget);
    await repository.save(gpt4o);

    // 3. Gemini Flash (Fast model in maintenance)
    const geminiFlash = new CanonicalModel({
      id: 'gemini-flash',
      displayName: 'Gemini Flash',
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
      expect(defaultCatalog.map((m) => m.id)).toEqual(['claude-sonnet', 'gpt-4o']);

      // With selectableOnly=false, all models including maintenance models are returned
      const allCatalog = await catalogUseCase.execute({ selectableOnly: false });
      expect(allCatalog).toHaveLength(3);

      const sonnetEntry = allCatalog.find((m) => m.id === 'claude-sonnet')!;
      expect(sonnetEntry).toBeDefined();
      expect(sonnetEntry.displayName).toBe('Claude Sonnet');
      expect(sonnetEntry.family).toBe('anthropic');
      expect(sonnetEntry.activeVersion).toBe('v1.0.0');
      expect(sonnetEntry.isSelectable).toBe(true);
      expect(sonnetEntry.capabilities.reasoning).toBe(true);
      expect(sonnetEntry.capabilities.supportedEffortLevels).toEqual(['low', 'medium', 'high']);
      expect(sonnetEntry.capabilities.defaultEffortLevel).toBe('medium');

      // Crucial: Provider targets and upstream IDs are strictly omitted from the catalog
      expect(
        (sonnetEntry as unknown as Record<string, unknown>)['eligibleTargets'],
      ).toBeUndefined();
      expect(
        (sonnetEntry as unknown as Record<string, unknown>)['upstreamModelId'],
      ).toBeUndefined();
    });

    it('filters catalog by selectableOnly to omit models in maintenance/deprecated state', async () => {
      const allEntries = await catalogUseCase.execute({ selectableOnly: false });
      expect(allEntries).toHaveLength(3);
      expect(allEntries.find((m) => m.id === 'gemini-flash')?.isSelectable).toBe(false);

      const selectableEntries = await catalogUseCase.execute({ selectableOnly: true });
      expect(selectableEntries).toHaveLength(2);
      expect(selectableEntries.map((m) => m.id)).toEqual(['claude-sonnet', 'gpt-4o']);
    });

    it('filters catalog by family category', async () => {
      const anthropicModels = await catalogUseCase.execute({ family: 'anthropic' });
      expect(anthropicModels).toHaveLength(1);
      expect(anthropicModels[0]?.id).toBe('claude-sonnet');

      const openaiModels = await catalogUseCase.execute({ family: 'openai' });
      expect(openaiModels).toHaveLength(1);
      expect(openaiModels[0]?.id).toBe('gpt-4o');
    });

    it('throws VersionNotFoundError when model activeVersion cannot be found (removes silent fallback)', async () => {
      const corruptedModel = new CanonicalModel({
        id: 'corrupted-model',
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
        canonicalModelId: 'claude-sonnet',
        effort: 'high',
        correlationId: 'test-trace-1',
      });

      expect(resolution.canonicalModelId).toBe('claude-sonnet');
      expect(resolution.effort).toBe('high');
      expect(resolution.capabilities.reasoning).toBe(true);
      expect(resolution.capabilities.supportedEffortLevels).toContain('high');
    });

    it('assigns model default effort level when effort is omitted on a reasoning model', async () => {
      const resolution = await resolveUseCase.execute({
        canonicalModelId: 'claude-sonnet',
        correlationId: 'test-trace-2',
      });

      expect(resolution.canonicalModelId).toBe('claude-sonnet');
      // Defaults to configured defaultEffortLevel ('medium')
      expect(resolution.effort).toBe('medium');
    });

    it('rejects effort parameter on models that do not support reasoning with UNSUPPORTED_EFFORT_LEVEL', async () => {
      await expect(
        resolveUseCase.execute({
          canonicalModelId: 'gpt-4o',
          effort: 'high',
          correlationId: 'test-trace-3',
        }),
      ).rejects.toThrowError(UnsupportedEffortError);

      try {
        await resolveUseCase.execute({
          canonicalModelId: 'gpt-4o',
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
          canonicalModelId: 'claude-sonnet',
          effort: 'ultra-maximum',
          correlationId: 'test-trace-4',
        }),
      ).rejects.toThrowError(UnsupportedEffortError);

      try {
        await resolveUseCase.execute({
          canonicalModelId: 'claude-sonnet',
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
        canonicalModelId: 'claude-sonnet',
        correlationId: 'test-trace-5',
      });

      expect(resolution.eligibleTargets).toHaveLength(2);
      // Priority 1 target is first
      expect(resolution.eligibleTargets[0]?.targetId).toBe('target-anthropic-direct');
      expect(resolution.eligibleTargets[0]?.provider).toBe('anthropic');
      expect(resolution.eligibleTargets[0]?.priority).toBe(1);

      // Priority 2 fallback target is second
      expect(resolution.eligibleTargets[1]?.targetId).toBe('target-bedrock-fallback');
      expect(resolution.eligibleTargets[1]?.provider).toBe('bedrock');
      expect(resolution.eligibleTargets[1]?.priority).toBe(2);
    });

    it('seamlessly reroutes to fallback provider target when primary target is cordoned (maintenance)', async () => {
      const model = (await repository.findById('claude-sonnet'))!;

      // Cordon primary Anthropic direct target (simulate upstream vendor outage or quota exhaustion)
      model.updateTargetStatus('target-anthropic-direct', 'maintenance');
      await repository.save(model);
      await cache.invalidateModel('claude-sonnet');

      const resolution = await resolveUseCase.execute({
        canonicalModelId: 'claude-sonnet',
        correlationId: 'test-trace-6',
      });

      // User-facing model ID remains stable as 'claude-sonnet'! BILLY requires NO changes!
      expect(resolution.canonicalModelId).toBe('claude-sonnet');
      expect(resolution.eligibleTargets).toHaveLength(1);
      expect(resolution.eligibleTargets[0]?.targetId).toBe('target-bedrock-fallback');
      expect(resolution.eligibleTargets[0]?.provider).toBe('bedrock');
      expect(resolution.eligibleTargets[0]?.upstreamModelId).toBe(
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
      );
    });
  });
});
