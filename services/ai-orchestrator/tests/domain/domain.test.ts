import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@oicunt-ai/ai-types';
import type { ModelPricing, TokenUsage } from '@oicunt-ai/model-types';
import { ContextWindowEstimator } from '../../src/domain/context-window-estimator.js';
import { CostCalculator, calculateTurnCost } from '../../src/domain/cost-calculator.js';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  ModelInMaintenanceError,
  UnsupportedEffortLevelError,
} from '../../src/domain/errors.js';

describe('Domain - ContextWindowEstimator', () => {
  it('estimates prompt tokens for simple string content messages', () => {
    const messages: readonly ChatMessage[] = [
      { role: 'user', content: 'Hello world! 1234' }, // 17 chars -> ~5 tokens
    ];

    const tokens = ContextWindowEstimator.estimateMessagesTokens(messages);
    expect(tokens).toBe(9); // 5 content + 4 message frame
  });

  it('estimates prompt tokens for multipart messages including images and thinking', () => {
    const messages: readonly ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this image:' }, // 19 chars -> ~5 tokens
          { type: 'image', mimeType: 'image/png', data: 'base64...' }, // 1000 tokens
          { type: 'thinking', thinking: 'Internal reasoning...' }, // 22 chars -> ~6 tokens
        ],
      },
    ];

    const tokens = ContextWindowEstimator.estimateMessagesTokens(messages);
    expect(tokens).toBe(1015); // 5 text + 1000 image + 6 thinking + 4 frame
  });

  it('correctly validates if request is within context limit', () => {
    const messages: readonly ChatMessage[] = [
      { role: 'user', content: 'A short prompt' }, // 14 chars -> ~4 tokens + 4 frame = 8
    ];

    expect(ContextWindowEstimator.isWithinLimit(messages, 100, 50).valid).toBe(true);
    expect(ContextWindowEstimator.isWithinLimit(messages, 50, 50).valid).toBe(false); // 8 + 50 > 50
  });
});

describe('Domain - CostCalculator', () => {
  const pricing: ModelPricing = {
    costPerMillionInputTokens: 3.0,
    costPerMillionOutputTokens: 15.0,
    costPerMillionCachedTokens: 0.3,
  };

  it('calculates turn cost accurately with prompt, cached, and output tokens', () => {
    const usage: TokenUsage = {
      promptTokens: 10_000,
      completionTokens: 2_000,
      totalTokens: 12_000,
      cachedTokens: 2_000,
    };

    // Prompt non-cached: 8000 -> 8000 * 3.0 / 1M = 0.024
    // Cached: 2000 -> 2000 * 0.3 / 1M = 0.0006
    // Completion: 2000 -> 2000 * 15.0 / 1M = 0.030
    // Total: 0.0546
    const cost = CostCalculator.calculateCostUsd(usage, pricing);
    expect(cost).toBeCloseTo(0.0546, 5);
    expect(calculateTurnCost(pricing, usage)).toBeCloseTo(0.0546, 5);
  });

  it('returns undefined if pricing or usage is omitted', () => {
    expect(
      CostCalculator.calculateCostUsd(
        { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        undefined,
      ),
    ).toBeUndefined();
    expect(calculateTurnCost(undefined, undefined)).toBeUndefined();
  });
});

describe('Domain - Errors', () => {
  it('instantiates domain errors with correct HTTP status codes and payloads', () => {
    const err = new UnsupportedEffortLevelError(
      'claude-sonnet',
      'max',
      ['low', 'medium', 'high'],
      'corr_123',
    );
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('UNSUPPORTED_EFFORT_LEVEL');
    expect(err.retryable).toBe(false);

    const payload = err.toPayload();
    expect(payload.code).toBe('UNSUPPORTED_EFFORT_LEVEL');
    expect(payload.canonicalModelId).toBe('claude-sonnet');
    expect(payload.correlationId).toBe('corr_123');
  });

  it('formats ContextWindowExceededError correctly', () => {
    const err = new ContextWindowExceededError('claude-sonnet', 200_000, 210_000, 'corr_456');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('CONTEXT_WINDOW_EXCEEDED');
    expect(err.details).toEqual({
      model: 'claude-sonnet',
      limit: 200_000,
      estimatedTokens: 210_000,
    });
  });

  it('creates maintenance and exhaustion errors with retryable=true', () => {
    const maint = new ModelInMaintenanceError('claude-sonnet');
    expect(maint.statusCode).toBe(503);
    expect(maint.retryable).toBe(true);

    const exhaust = new AllTargetsExhaustedError('claude-sonnet');
    expect(exhaust.statusCode).toBe(503);
    expect(exhaust.retryable).toBe(true);
  });
});
