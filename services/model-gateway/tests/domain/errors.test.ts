import { describe, expect, it } from 'vitest';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  InferenceTimeoutError,
  InvalidRequestError,
  ModelUnavailableError,
  ProviderAuthenticationError,
  RateLimitExceededError,
  StreamInterruptedError,
  UnsupportedCapabilityError,
  UnsupportedEffortLevelError,
} from '../../src/domain/errors.js';

describe('Gateway Error Taxonomy', () => {
  it('instantiates strongly typed Gateway errors with appropriate status codes and retry flags', () => {
    const rateLimit = new RateLimitExceededError('claude-sonnet', 'corr-1', 'target-1');
    expect(rateLimit.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(rateLimit.statusCode).toBe(429);
    expect(rateLimit.retryable).toBe(true);
    expect(rateLimit.targetId).toBe('target-1');

    const authError = new ProviderAuthenticationError('claude-sonnet', 'corr-2', 'target-1');
    expect(authError.code).toBe('PROVIDER_AUTHENTICATION_ERROR');
    expect(authError.statusCode).toBe(500);
    expect(authError.retryable).toBe(false);

    const ctxError = new ContextWindowExceededError('claude-sonnet', 'corr-3', {
      maxTokens: 200000,
      actualTokens: 250000,
    });
    expect(ctxError.code).toBe('CONTEXT_WINDOW_EXCEEDED');
    expect(ctxError.statusCode).toBe(400);
    expect(ctxError.retryable).toBe(false);

    const unavail = new ModelUnavailableError('claude-sonnet', 'corr-4', 'target-1');
    expect(unavail.code).toBe('MODEL_UNAVAILABLE');
    expect(unavail.statusCode).toBe(503);
    expect(unavail.retryable).toBe(true);

    const exhausted = new AllTargetsExhaustedError('claude-sonnet', 'corr-5');
    expect(exhausted.code).toBe('ALL_TARGETS_EXHAUSTED');
    expect(exhausted.statusCode).toBe(503);
    expect(exhausted.retryable).toBe(false);

    const timeout = new InferenceTimeoutError('claude-sonnet', 'corr-6', 'target-1');
    expect(timeout.code).toBe('INFERENCE_TIMEOUT');
    expect(timeout.statusCode).toBe(504);

    const streamErr = new StreamInterruptedError('claude-sonnet', 'corr-7', 'target-1');
    expect(streamErr.code).toBe('STREAM_INTERRUPTED');
    expect(streamErr.statusCode).toBe(502);

    const unsuppEffort = new UnsupportedEffortLevelError('claude-sonnet', 'high', 'corr-8');
    expect(unsuppEffort.code).toBe('UNSUPPORTED_EFFORT_LEVEL');
    expect(unsuppEffort.statusCode).toBe(400);

    const unsuppCap = new UnsupportedCapabilityError('claude-sonnet', 'tools', 'corr-9');
    expect(unsuppCap.code).toBe('UNSUPPORTED_CAPABILITY');
    expect(unsuppCap.statusCode).toBe(400);
  });

  it('formats clean public error payload with toPayload() without leaking sensitive internals', () => {
    const err = new InvalidRequestError(
      'gpt-4o',
      'Parameter temperature is out of range',
      'corr-10',
      {
        temperature: 5.0,
      },
    );
    const payload = err.toPayload();

    expect(payload.code).toBe('INVALID_REQUEST');
    expect(payload.message).toBe('Parameter temperature is out of range');
    expect(payload.canonicalModelId).toBe('gpt-4o');
    expect(payload.correlationId).toBe('corr-10');
    expect(payload.retryable).toBe(false);
    expect(payload.details).toEqual({ temperature: 5.0 });
  });

  it('sanitizes provider authentication error message to prevent secret leaking', () => {
    const authErr = new ProviderAuthenticationError('claude-sonnet', 'corr-11', 'target-1');
    const payload = authErr.toPayload();

    expect(payload.message).toBe('Model service configuration error.');
    expect(payload.message).not.toContain('key');
    expect(payload.message).not.toContain('secret');
  });
});
