import { describe, expect, it } from 'vitest';
import {
  CanonicalModel,
  ModelVersion,
  ModelTarget,
  OptimisticLockError,
} from '../../src/domain/index.js';
import { InMemoryModelRepository } from '../../src/infrastructure/repositories/in-memory-model.repository.js';

describe('Model Repository Specification & Optimistic Concurrency', () => {
  it('saves and retrieves canonical model with versions and targets', async () => {
    const repo = new InMemoryModelRepository();

    const model = new CanonicalModel({
      id: 'oicunt.model.vision',
      displayName: 'Vision Model',
      description: 'Multimodal vision specialist',
      activeVersion: 'v1.0.0',
    });

    const v1 = new ModelVersion({
      id: 'ver-uuid-vision-1',
      canonicalModelId: model.id,
      version: 'v1.0.0',
      modalities: ['text', 'image'],
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredOutputs: true,
        reasoning: false,
        vision: true,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
      },
      limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
    });

    const target1 = new ModelTarget({
      id: 'target-google-vision-us',
      modelVersionId: v1.id,
      provider: 'google',
      upstreamModelId: 'gemini-1.5-flash',
      priority: 1,
      weight: 100,
    });

    model.addVersion(v1);
    model.addTarget(target1);

    await repo.save(model);

    const retrieved = await repo.findById('oicunt.model.vision');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe('oicunt.model.vision');
    expect(retrieved?.getVersions()).toHaveLength(1);
    expect(retrieved?.getTargets()).toHaveLength(1);
    expect(retrieved?.getTarget('target-google-vision-us')?.provider).toBe('google');
  });

  it('enforces optimistic concurrency control and throws OptimisticLockError on collision', async () => {
    const repo = new InMemoryModelRepository();

    const model = new CanonicalModel({
      id: 'oicunt.model.coding',
      displayName: 'Coding',
      description: 'Code model',
      activeVersion: 'v1.0.0',
    });

    await repo.save(model); // initial version_lock = 1

    // Process A loads model at lock = 1
    const processA = (await repo.findById('oicunt.model.coding'))!;
    expect(processA.versionLock).toBe(1);

    // Process B loads model at lock = 1
    const processB = (await repo.findById('oicunt.model.coding'))!;
    expect(processB.versionLock).toBe(1);

    // Process A updates and saves with expected lock = 1
    processA.incrementVersionLock(); // versionLock is now 2
    await repo.save(processA, 1);

    // Process B tries to save with stale expected lock = 1
    processB.incrementVersionLock();
    await expect(repo.save(processB, 1)).rejects.toThrowError(OptimisticLockError);
  });
});
