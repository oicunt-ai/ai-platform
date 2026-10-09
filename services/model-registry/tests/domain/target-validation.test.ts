import { describe, expect, it } from 'vitest';
import type { ModelProviderType } from '@oicunt-ai/model-types';
import { ModelTarget, ModelValidationError } from '../../src/domain/index.js';

describe('ModelTarget Domain Entity Validation', () => {
  it('accepts new provider IDs without an application-level allowlist', () => {
    expect(
      new ModelTarget({
        id: 'target-1',
        modelVersionId: 'ver-1',
        provider: 'new-provider' as ModelProviderType,
        upstreamModelId: 'custom-model',
      }).provider,
    ).toBe('new-provider');
  });

  it('rejects malformed provider IDs', () => {
    expect(
      () =>
        new ModelTarget({
          id: 'target-1',
          modelVersionId: 'ver-1',
          provider: 'Invalid Provider' as unknown as ModelProviderType,
          upstreamModelId: 'custom-model',
        }),
    ).toThrowError(ModelValidationError);
  });

  it('rejects upstream model IDs that contain whitespace', () => {
    expect(
      () =>
        new ModelTarget({
          id: 'target-1',
          modelVersionId: 'ver-1',
          provider: 'test-provider',
          upstreamModelId: 'provider model with spaces',
        }),
    ).toThrowError(ModelValidationError);
  });

  it('validates priority >= 1 and weight between 1 and 100', () => {
    expect(
      () =>
        new ModelTarget({
          id: 'target-1',
          modelVersionId: 'ver-1',
          provider: 'test-provider',
          upstreamModelId: 'provider-model-alpha',
          priority: 0,
        }),
    ).toThrowError(ModelValidationError);

    expect(
      () =>
        new ModelTarget({
          id: 'target-1',
          modelVersionId: 'ver-1',
          provider: 'test-provider',
          upstreamModelId: 'provider-model-alpha',
          priority: 1,
          weight: 150,
        }),
    ).toThrowError(ModelValidationError);
  });

  it('evaluates target eligibility correctly across statuses', () => {
    const target = new ModelTarget({
      id: 'target-1',
      modelVersionId: 'ver-1',
      provider: 'test-provider',
      upstreamModelId: 'provider-model-alpha',
      status: 'available',
    });

    expect(target.isEligible(true)).toBe(true);
    expect(target.isEligible(false)).toBe(true);

    target.updateStatus('degraded');
    expect(target.isEligible(true)).toBe(true);
    expect(target.isEligible(false)).toBe(false);

    target.updateStatus('maintenance');
    expect(target.isEligible(true)).toBe(false);
    expect(target.isEligible(false)).toBe(false);

    target.updateStatus('deprecated');
    expect(target.isEligible(true)).toBe(false);
    expect(target.isEligible(false)).toBe(false);
  });

  it('rejects provider credentials anywhere in adapter metadata', () => {
    expect(
      () =>
        new ModelTarget({
          id: 'target-secret',
          modelVersionId: 'ver-1',
          provider: 'test-provider',
          upstreamModelId: 'provider-model-alpha',
          adapterOptions: { transport: { apiKey: 'must-not-be-stored' } },
        }),
    ).toThrowError(ModelValidationError);
  });
});
