import { describe, it, expect } from 'vitest';
import {
  AuthenticationError,
  BatchTooLargeError,
  DeadlineExceededError,
  DimensionMismatchError,
  EmptyInputError,
  EmptyInputItemError,
  ForbiddenError,
  InputTooLargeError,
  InternalEmbeddingError,
  InvalidDimensionsError,
  InvalidRequestError,
  ModelUnavailableError,
  ProviderExecutionFailedError,
  RateLimitedError,
  RequestCancelledError,
  UnsupportedCapabilityError,
  UnsupportedModelError,
} from '../../src/domain/errors.js';

describe('Embeddings Error Taxonomy', () => {
  it('assigns correct HTTP status, codes, and retryable flags', () => {
    const invalidReq = new InvalidRequestError('bad input');
    expect(invalidReq.code).toBe('INVALID_REQUEST');
    expect(invalidReq.statusCode).toBe(400);
    expect(invalidReq.retryable).toBe(false);

    const emptyInput = new EmptyInputError();
    expect(emptyInput.code).toBe('EMPTY_INPUT');
    expect(emptyInput.statusCode).toBe(400);
    expect(emptyInput.retryable).toBe(false);

    const emptyItem = new EmptyInputItemError(2);
    expect(emptyItem.code).toBe('EMPTY_INPUT_ITEM');
    expect(emptyItem.statusCode).toBe(400);
    expect(emptyItem.retryable).toBe(false);

    const inputTooLarge = new InputTooLargeError('too large');
    expect(inputTooLarge.code).toBe('INPUT_TOO_LARGE');
    expect(inputTooLarge.statusCode).toBe(400);
    expect(inputTooLarge.retryable).toBe(false);

    const batchTooLarge = new BatchTooLargeError(300, 256);
    expect(batchTooLarge.code).toBe('BATCH_TOO_LARGE');
    expect(batchTooLarge.statusCode).toBe(400);
    expect(batchTooLarge.retryable).toBe(false);

    const unsuppModel = new UnsupportedModelError('unknown-model');
    expect(unsuppModel.code).toBe('UNSUPPORTED_MODEL');
    expect(unsuppModel.statusCode).toBe(404);
    expect(unsuppModel.retryable).toBe(false);

    const unsuppCap = new UnsupportedCapabilityError('provider-model-beta', 'embedding');
    expect(unsuppCap.code).toBe('UNSUPPORTED_CAPABILITY');
    expect(unsuppCap.statusCode).toBe(400);
    expect(unsuppCap.retryable).toBe(false);

    const invDims = new InvalidDimensionsError('invalid dimensions');
    expect(invDims.code).toBe('INVALID_DIMENSIONS');
    expect(invDims.statusCode).toBe(400);
    expect(invDims.retryable).toBe(false);

    const authErr = new AuthenticationError('missing token');
    expect(authErr.code).toBe('AUTHENTICATION_ERROR');
    expect(authErr.statusCode).toBe(401);
    expect(authErr.retryable).toBe(false);

    const forbidden = new ForbiddenError('forbidden');
    expect(forbidden.code).toBe('FORBIDDEN');
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.retryable).toBe(false);

    const rateLimited = new RateLimitedError('rate limited');
    expect(rateLimited.code).toBe('RATE_LIMITED');
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.retryable).toBe(true);

    const reqCancelled = new RequestCancelledError('aborted');
    expect(reqCancelled.code).toBe('REQUEST_CANCELLED');
    expect(reqCancelled.statusCode).toBe(499);
    expect(reqCancelled.retryable).toBe(false);

    const deadline = new DeadlineExceededError('deadline');
    expect(deadline.code).toBe('DEADLINE_EXCEEDED');
    expect(deadline.statusCode).toBe(504);
    expect(deadline.retryable).toBe(true);

    const modelUnavail = new ModelUnavailableError('unavailable');
    expect(modelUnavail.code).toBe('MODEL_UNAVAILABLE');
    expect(modelUnavail.statusCode).toBe(503);
    expect(modelUnavail.retryable).toBe(true);

    const provFailed = new ProviderExecutionFailedError('provider failed');
    expect(provFailed.code).toBe('PROVIDER_EXECUTION_FAILED');
    expect(provFailed.statusCode).toBe(502);
    expect(provFailed.retryable).toBe(true);

    const dimMismatch = new DimensionMismatchError(1536, 768, 0);
    expect(dimMismatch.code).toBe('PROVIDER_EXECUTION_FAILED');
    expect(dimMismatch.statusCode).toBe(502);
    expect(dimMismatch.retryable).toBe(false);

    const internalErr = new InternalEmbeddingError('internal error');
    expect(internalErr.code).toBe('INTERNAL_EMBEDDING_ERROR');
    expect(internalErr.statusCode).toBe(500);
    expect(internalErr.retryable).toBe(false);
  });
});
