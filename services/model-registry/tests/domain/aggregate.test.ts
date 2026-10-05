import { describe, expect, it } from 'vitest';
import type { CanonicalModelId } from '@oicunt-ai/model-types';
import {
  CanonicalModel,
  ModelVersion,
  ModelTarget,
  ModelValidationError,
  VersionNotFoundError,
} from '../../src/domain/index.js';

describe('CanonicalModel Aggregate Root', () => {
  const createTestModel = () => {
    const model = new CanonicalModel({
      id: 'oicunt.model.general',
      displayName: 'General Intelligence',
      description: 'Flagship conversational intelligence model',
      activeVersion: 'v1.0.0',
    });

    const v1 = new ModelVersion({
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
      limits: {
        contextWindowTokens: 128000,
        maxOutputTokens: 4096,
      },
      pricing: {
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
      },
    });

    model.addVersion(v1);
    return { model, v1 };
  };

  it('enforces canonical model ID pattern ^[a-z0-9][a-z0-9._-]{1,63}$', () => {
    expect(
      () =>
        new CanonicalModel({
          id: 'INVALID_UPPERCASE' as unknown as CanonicalModelId,
          displayName: 'Test',
          description: 'Desc',
          activeVersion: 'v1.0.0',
        }),
    ).toThrowError(ModelValidationError);

    expect(
      () =>
        new CanonicalModel({
          id: 'invalid@symbols!' as unknown as CanonicalModelId,
          displayName: 'Test',
          description: 'Desc',
          activeVersion: 'v1.0.0',
        }),
    ).toThrowError(ModelValidationError);

    // Valid user-facing models:
    const sonnet = new CanonicalModel({
      id: 'claude-sonnet',
      displayName: 'Claude Sonnet',
      description: 'Frontier reasoning model',
      family: 'anthropic',
      activeVersion: 'v1.0.0',
    });
    expect(sonnet.id).toBe('claude-sonnet');
    expect(sonnet.family).toBe('anthropic');

    const gpt = new CanonicalModel({
      id: 'gpt-4o',
      displayName: 'GPT-4o',
      description: 'Omni model',
      family: 'openai',
      activeVersion: 'v1.0.0',
    });
    expect(gpt.id).toBe('gpt-4o');

    const legacy = new CanonicalModel({
      id: 'oicunt.model.coding-expert',
      displayName: 'Coding Expert',
      description: 'Expert coding model',
      activeVersion: 'v1.0.0',
    });
    expect(legacy.id).toBe('oicunt.model.coding-expert');
  });

  it('rejects empty display name or description', () => {
    expect(
      () =>
        new CanonicalModel({
          id: 'oicunt.model.general',
          displayName: '  ',
          description: 'Desc',
          activeVersion: 'v1.0.0',
        }),
    ).toThrowError(ModelValidationError);

    expect(
      () =>
        new CanonicalModel({
          id: 'oicunt.model.general',
          displayName: 'General',
          description: '',
          activeVersion: 'v1.0.0',
        }),
    ).toThrowError(ModelValidationError);
  });

  it('prevents duplicate versions within the same model aggregate', () => {
    const { model, v1 } = createTestModel();
    expect(() => model.addVersion(v1)).toThrowError(ModelValidationError);
  });

  it('rejects targets that reference non-existent model versions', () => {
    const { model } = createTestModel();
    const orphanTarget = new ModelTarget({
      id: 'target-1',
      modelVersionId: 'non-existent-version-uuid',
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet',
    });

    expect(() => model.addTarget(orphanTarget)).toThrowError(ModelValidationError);
  });

  it('increments version lock on mutation for optimistic locking', () => {
    const { model } = createTestModel();
    expect(model.versionLock).toBe(1);

    model.incrementVersionLock();
    expect(model.versionLock).toBe(2);
  });

  it('updates active version when valid version exists', () => {
    const { model } = createTestModel();
    const v2 = new ModelVersion({
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
      limits: {
        contextWindowTokens: 200000,
        maxOutputTokens: 8192,
      },
      pricing: {
        costPerMillionInputTokens: 5.0,
        costPerMillionOutputTokens: 25.0,
      },
    });

    model.addVersion(v2);
    model.setActiveVersion('v2.0.0');
    expect(model.activeVersion).toBe('v2.0.0');

    expect(() => model.setActiveVersion('v9.9.9')).toThrowError(VersionNotFoundError);
  });
});
