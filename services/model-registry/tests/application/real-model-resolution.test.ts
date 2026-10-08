import { beforeEach, describe, expect, it } from 'vitest';
import { createRealModelDefinition, registerRealModel } from '../../src/domain/real-model.js';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';
import { InMemoryModelCache } from '../../src/infrastructure/cache/in-memory-model-cache.js';
import { ResolveModelUseCase } from '../../src/application/use-cases/resolve-model.use-case.js';
import { UnsupportedEffortError } from '../../src/domain/errors.js';

describe('Real Model Registry Resolution (Claude 3.5 Sonnet / Anthropic)', () => {
  let repository: InMemoryModelRepository;
  let cache: InMemoryModelCache;
  let resolveUseCase: ResolveModelUseCase;

  beforeEach(async () => {
    repository = new InMemoryModelRepository();
    cache = new InMemoryModelCache();
    resolveUseCase = new ResolveModelUseCase(repository, cache);

    // Register the real model
    await registerRealModel(repository);
  });

  it('correctly defines the real model aggregate structure', () => {
    const model = createRealModelDefinition();

    expect(model.id).toBe('claude-sonnet');
    expect(model.displayName).toBe('Claude 3.5 Sonnet');
    expect(model.family).toBe('claude');
    expect(model.activeVersion).toBe('v1.0.0');

    const v1 = model.getVersion('v1.0.0');
    expect(v1).toBeDefined();
    expect(v1?.capabilities.reasoning).toBe(true);
    expect(v1?.capabilities.supportedEffortLevels).toEqual(['low', 'medium', 'high']);
    expect(v1?.limits.contextWindowTokens).toBe(200000);
    expect(v1?.limits.maxOutputTokens).toBe(8192);

    const targets = model.getTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0]?.provider).toBe('anthropic');
    expect(targets[0]?.upstreamModelId).toBe('claude-3-5-sonnet-20241022');
    expect(targets[0]?.priority).toBe(1);
  });

  it('resolves claude-sonnet to the concrete Anthropic target through ResolveModelUseCase', async () => {
    const resolution = await resolveUseCase.execute({
      canonicalModelId: 'claude-sonnet',
      correlationId: 'corr-real-model-1',
    });

    expect(resolution.canonicalModelId).toBe('claude-sonnet');
    expect(resolution.version).toBe('v1.0.0');
    expect(resolution.limits.contextWindowTokens).toBe(200000);
    expect(resolution.limits.maxOutputTokens).toBe(8192);
    expect(resolution.eligibleTargets).toHaveLength(1);

    const target = resolution.eligibleTargets[0];
    expect(target).toBeDefined();
    expect(target?.provider).toBe('anthropic');
    expect(target?.upstreamModelId).toBe('claude-3-5-sonnet-20241022');
    expect(target?.priority).toBe(1);
    expect(target?.weight).toBe(100);
  });

  it('resolves alias "latest" to active version v1.0.0', async () => {
    const resolution = await resolveUseCase.execute({
      canonicalModelId: 'claude-sonnet',
      version: 'latest',
      correlationId: 'corr-alias-1',
    });

    expect(resolution.version).toBe('v1.0.0');
    expect(resolution.eligibleTargets[0]?.provider).toBe('anthropic');
  });

  it('supports reasoning effort levels for the real model', async () => {
    const resolution = await resolveUseCase.execute({
      canonicalModelId: 'claude-sonnet',
      effort: 'high',
      correlationId: 'corr-effort-1',
    });

    expect(resolution.effort).toBe('high');
  });

  it('rejects unsupported effort levels with UnsupportedEffortError', async () => {
    await expect(
      resolveUseCase.execute({
        canonicalModelId: 'claude-sonnet',
        effort: 'extreme',
        correlationId: 'corr-effort-fail',
      }),
    ).rejects.toThrow(UnsupportedEffortError);
  });
});
