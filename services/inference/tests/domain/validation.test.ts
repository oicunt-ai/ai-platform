import { describe, expect, it } from 'vitest';
import {
  ContextWindowExceededError,
  InferenceTimeoutError,
  InvalidRequestError,
  validateInferenceRequest,
} from '../../src/domain/index.js';
import { calculateInferenceCost } from '../../src/domain/cost-calculator.js';
import type { ModelLimits, ModelPricing } from '@oicunt-ai/model-types';
import type { ValidatableInferenceRequest } from '../../src/domain/validation.js';

describe('Domain - Validation & Cost Calculator', () => {
  const validLimits: ModelLimits = {
    contextWindowTokens: 128_000,
    maxOutputTokens: 4096,
  };

  const validRequest: ValidatableInferenceRequest = {
    canonicalModelId: 'oicunt.model.catalog-alpha',
    messages: [{ role: 'user', content: 'Hello world' }],
    limits: validLimits,
    deadlineMs: Date.now() + 30_000,
  };

  describe('validateInferenceRequest', () => {
    it('passes for a valid request', () => {
      expect(() => validateInferenceRequest(validRequest, 'corr_1')).not.toThrow();
    });

    it('throws InvalidRequestError if canonicalModelId is missing or whitespace', () => {
      expect(() =>
        validateInferenceRequest({ ...validRequest, canonicalModelId: '' }, 'corr_1'),
      ).toThrow(InvalidRequestError);

      expect(() =>
        validateInferenceRequest({ ...validRequest, canonicalModelId: '   ' }, 'corr_1'),
      ).toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError if messages array is empty or invalid', () => {
      expect(() => validateInferenceRequest({ ...validRequest, messages: [] }, 'corr_1')).toThrow(
        InvalidRequestError,
      );
    });

    it('throws InvalidRequestError if a message has missing role or content', () => {
      expect(() =>
        validateInferenceRequest(
          { ...validRequest, messages: [{ role: '' as unknown as 'user', content: 'hi' }] },
          'corr_1',
        ),
      ).toThrow(InvalidRequestError);

      expect(() =>
        validateInferenceRequest(
          {
            ...validRequest,
            messages: [{ role: 'user', content: undefined as unknown as string }],
          },
          'corr_1',
        ),
      ).toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError if limits are missing or non-positive', () => {
      expect(() =>
        validateInferenceRequest(
          { ...validRequest, limits: { contextWindowTokens: 0, maxOutputTokens: 100 } },
          'corr_1',
        ),
      ).toThrow(InvalidRequestError);

      expect(() =>
        validateInferenceRequest(
          { ...validRequest, limits: { contextWindowTokens: 1000, maxOutputTokens: -5 } },
          'corr_1',
        ),
      ).toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError if deadlineMs is invalid or non-positive', () => {
      expect(() => validateInferenceRequest({ ...validRequest, deadlineMs: -1 }, 'corr_1')).toThrow(
        InvalidRequestError,
      );

      expect(() =>
        validateInferenceRequest({ ...validRequest, deadlineMs: NaN }, 'corr_1'),
      ).toThrow(InvalidRequestError);
    });

    it('throws InferenceTimeoutError if deadlineMs is already expired', () => {
      expect(() =>
        validateInferenceRequest({ ...validRequest, deadlineMs: Date.now() - 100 }, 'corr_1'),
      ).toThrow(InferenceTimeoutError);
    });

    it('throws InvalidRequestError on invalid temperature', () => {
      expect(() =>
        validateInferenceRequest({ ...validRequest, parameters: { temperature: 2.5 } }, 'corr_1'),
      ).toThrow(InvalidRequestError);

      expect(() =>
        validateInferenceRequest({ ...validRequest, parameters: { temperature: -0.1 } }, 'corr_1'),
      ).toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError on invalid topP', () => {
      expect(() =>
        validateInferenceRequest({ ...validRequest, parameters: { topP: 1.5 } }, 'corr_1'),
      ).toThrow(InvalidRequestError);
    });

    it('throws InvalidRequestError on non-positive maxTokens', () => {
      expect(() =>
        validateInferenceRequest({ ...validRequest, parameters: { maxTokens: 0 } }, 'corr_1'),
      ).toThrow(InvalidRequestError);
    });

    it('throws ContextWindowExceededError when maxTokens exceeds limits.maxOutputTokens', () => {
      expect(() =>
        validateInferenceRequest({ ...validRequest, parameters: { maxTokens: 5000 } }, 'corr_1'),
      ).toThrow(ContextWindowExceededError);
    });
  });

  describe('calculateInferenceCost', () => {
    const pricing: ModelPricing = {
      costPerMillionInputTokens: 3.0,
      costPerMillionOutputTokens: 15.0,
      costPerMillionCachedTokens: 1.5,
    };

    it('calculates cost accurately with standard usage', () => {
      const usage = {
        promptTokens: 1_000_000,
        completionTokens: 500_000,
        totalTokens: 1_500_000,
      };

      const cost = calculateInferenceCost(pricing, usage);
      expect(cost).toBeCloseTo(3.0 + 7.5, 4); // $10.50
    });

    it('includes cached tokens when present', () => {
      const usage = {
        promptTokens: 1_000_000,
        completionTokens: 500_000,
        cachedTokens: 200_000,
        totalTokens: 1_700_000,
      };

      const cost = calculateInferenceCost(pricing, usage);
      expect(cost).toBeCloseTo(3.0 + 7.5 + 0.3, 4); // $10.80
    });

    it('returns undefined when pricing is not provided', () => {
      const usage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      const cost = calculateInferenceCost(undefined, usage);
      expect(cost).toBeUndefined();
    });
  });
});
