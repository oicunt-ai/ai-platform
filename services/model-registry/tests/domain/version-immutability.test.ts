import { describe, expect, it } from 'vitest';
import {
  ImmutableVersionViolationError,
  ModelValidationError,
  ModelVersion,
} from '../../src/domain/index.js';

describe('ModelVersion Domain Entity & Immutability', () => {
  const baseCapabilities = {
    streaming: true,
    toolCalling: true,
    structuredOutputs: true,
    reasoning: false,
    vision: true,
    audioInput: false,
    audioOutput: false,
    systemInstructions: true,
  };

  const baseLimits = {
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
  };

  const basePricing = {
    costPerMillionInputTokens: 3.0,
    costPerMillionOutputTokens: 15.0,
  };

  it('validates limits must be positive integers > 0', () => {
    expect(
      () =>
        new ModelVersion({
          canonicalModelId: 'oicunt.model.general',
          version: 'v1.0.0',
          modalities: ['text'],
          capabilities: baseCapabilities,
          limits: { contextWindowTokens: 0, maxOutputTokens: 1000 },
          pricing: basePricing,
        }),
    ).toThrowError(ModelValidationError);

    expect(
      () =>
        new ModelVersion({
          canonicalModelId: 'oicunt.model.general',
          version: 'v1.0.0',
          modalities: ['text'],
          capabilities: baseCapabilities,
          limits: { contextWindowTokens: 100000, maxOutputTokens: -1 },
          pricing: basePricing,
        }),
    ).toThrowError(ModelValidationError);
  });

  it('validates pricing must be non-negative >= 0', () => {
    expect(
      () =>
        new ModelVersion({
          canonicalModelId: 'oicunt.model.general',
          version: 'v1.0.0',
          modalities: ['text'],
          capabilities: baseCapabilities,
          limits: baseLimits,
          pricing: { costPerMillionInputTokens: -0.5, costPerMillionOutputTokens: 10.0 },
        }),
    ).toThrowError(ModelValidationError);
  });

  it('enforces SemVer version strings', () => {
    expect(
      () =>
        new ModelVersion({
          canonicalModelId: 'oicunt.model.general',
          version: 'latest',
          modalities: ['text'],
          capabilities: baseCapabilities,
          limits: baseLimits,
          pricing: basePricing,
        }),
    ).toThrowError(ModelValidationError);
  });

  it('prevents mutation of specifications when isImmutable is true', () => {
    const version = new ModelVersion({
      canonicalModelId: 'oicunt.model.general',
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: baseCapabilities,
      limits: baseLimits,
      pricing: basePricing,
      isImmutable: true,
    });

    expect(() =>
      version.updateSpecifications(
        baseCapabilities,
        { contextWindowTokens: 200000, maxOutputTokens: 8192 },
        basePricing,
        ['text'],
      ),
    ).toThrowError(ImmutableVersionViolationError);
  });

  it('permits status changes on published immutable versions', () => {
    const version = new ModelVersion({
      canonicalModelId: 'oicunt.model.general',
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: baseCapabilities,
      limits: baseLimits,
      pricing: basePricing,
      status: 'available',
      isImmutable: true,
    });

    version.updateStatus('maintenance');
    expect(version.status).toBe('maintenance');

    version.updateStatus('deprecated');
    expect(version.status).toBe('deprecated');
  });

  it('allows specifications update prior to publishing', () => {
    const draftVersion = new ModelVersion({
      canonicalModelId: 'oicunt.model.general',
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: baseCapabilities,
      limits: baseLimits,
      pricing: basePricing,
      isImmutable: false,
    });

    draftVersion.updateSpecifications(
      baseCapabilities,
      { contextWindowTokens: 256000, maxOutputTokens: 8192 },
      basePricing,
      ['text', 'image'],
    );

    expect(draftVersion.limits.contextWindowTokens).toBe(256000);
    expect(draftVersion.modalities).toEqual(['text', 'image']);

    // Once published, further edits are blocked
    draftVersion.publish();
    expect(draftVersion.isImmutable).toBe(true);

    expect(() =>
      draftVersion.updateSpecifications(baseCapabilities, baseLimits, basePricing, ['text']),
    ).toThrowError(ImmutableVersionViolationError);
  });

  describe('Reasoning effort capabilities validation', () => {
    it('accepts valid supportedEffortLevels and defaultEffortLevel', () => {
      const version = new ModelVersion({
        canonicalModelId: 'oicunt.model.reasoning',
        version: 'v1.0.0',
        modalities: ['text'],
        capabilities: {
          ...baseCapabilities,
          reasoning: true,
          supportedEffortLevels: ['low', 'medium', 'high'],
          defaultEffortLevel: 'medium',
        },
        limits: baseLimits,
        pricing: basePricing,
      });

      expect(version.capabilities.supportedEffortLevels).toEqual(['low', 'medium', 'high']);
      expect(version.capabilities.defaultEffortLevel).toBe('medium');
    });

    it('preserves existing behavior for models that do not support effort levels', () => {
      const version = new ModelVersion({
        canonicalModelId: 'oicunt.model.general',
        version: 'v1.0.0',
        modalities: ['text'],
        capabilities: baseCapabilities,
        limits: baseLimits,
        pricing: basePricing,
      });

      expect(version.capabilities.supportedEffortLevels).toBeUndefined();
      expect(version.capabilities.defaultEffortLevel).toBeUndefined();
    });

    it('throws ModelValidationError when supportedEffortLevels is non-empty but defaultEffortLevel is missing', () => {
      expect(
        () =>
          new ModelVersion({
            canonicalModelId: 'oicunt.model.reasoning',
            version: 'v1.0.0',
            modalities: ['text'],
            capabilities: {
              ...baseCapabilities,
              reasoning: true,
              supportedEffortLevels: ['low', 'high'],
            },
            limits: baseLimits,
            pricing: basePricing,
          }),
      ).toThrowError(ModelValidationError);
    });

    it('throws ModelValidationError when defaultEffortLevel is not in supportedEffortLevels', () => {
      expect(
        () =>
          new ModelVersion({
            canonicalModelId: 'oicunt.model.reasoning',
            version: 'v1.0.0',
            modalities: ['text'],
            capabilities: {
              ...baseCapabilities,
              reasoning: true,
              supportedEffortLevels: ['low', 'medium'],
              defaultEffortLevel: 'high',
            },
            limits: baseLimits,
            pricing: basePricing,
          }),
      ).toThrowError(ModelValidationError);
    });

    it('throws ModelValidationError when defaultEffortLevel is provided without supportedEffortLevels', () => {
      expect(
        () =>
          new ModelVersion({
            canonicalModelId: 'oicunt.model.reasoning',
            version: 'v1.0.0',
            modalities: ['text'],
            capabilities: {
              ...baseCapabilities,
              reasoning: true,
              defaultEffortLevel: 'low',
            },
            limits: baseLimits,
            pricing: basePricing,
          }),
      ).toThrowError(ModelValidationError);
    });

    it('enforces effort level validation on updateSpecifications prior to publishing', () => {
      const draft = new ModelVersion({
        canonicalModelId: 'oicunt.model.reasoning',
        version: 'v1.0.0',
        modalities: ['text'],
        capabilities: baseCapabilities,
        limits: baseLimits,
        pricing: basePricing,
        isImmutable: false,
      });

      expect(() =>
        draft.updateSpecifications(
          {
            ...baseCapabilities,
            supportedEffortLevels: ['low'],
            defaultEffortLevel: 'high',
          },
          baseLimits,
          basePricing,
          ['text'],
        ),
      ).toThrowError(ModelValidationError);
    });
  });
});
