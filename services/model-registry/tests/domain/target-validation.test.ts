import { describe, expect, it } from 'vitest';
import type { ModelProviderType } from '@oicunt-ai/model-types';
import { ModelTarget, ModelValidationError } from '../../src/domain/index.js';

describe('ModelTarget Domain Entity Validation', () => {
  it('validates provider category against approved providers', () => {
    expect(
      () =>
        new ModelTarget({
          id: 'target-1',
          modelVersionId: 'ver-1',
          provider: 'unsupported-provider' as unknown as ModelProviderType,
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
          provider: 'anthropic',
          upstreamModelId: 'claude 3.5 sonnet',
        }),
    ).toThrowError(ModelValidationError);
  });

  it('validates priority >= 1 and weight between 1 and 100', () => {
    expect(
      () =>
        new ModelTarget({
          id: 'target-1',
          modelVersionId: 'ver-1',
          provider: 'anthropic',
          upstreamModelId: 'claude-3-5-sonnet',
          priority: 0,
        }),
    ).toThrowError(ModelValidationError);

    expect(
      () =>
        new ModelTarget({
          id: 'target-1',
          modelVersionId: 'ver-1',
          provider: 'anthropic',
          upstreamModelId: 'claude-3-5-sonnet',
          priority: 1,
          weight: 150,
        }),
    ).toThrowError(ModelValidationError);
  });

  it('evaluates target eligibility correctly across statuses', () => {
    const target = new ModelTarget({
      id: 'target-1',
      modelVersionId: 'ver-1',
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet',
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
});
