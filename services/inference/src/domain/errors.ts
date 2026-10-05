export type InferenceErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION_ERROR'
  | 'FORBIDDEN'
  | 'CONTEXT_WINDOW_EXCEEDED'
  | 'UNSUPPORTED_EFFORT_LEVEL'
  | 'REQUEST_CANCELLED'
  | 'ALL_TARGETS_EXHAUSTED'
  | 'MODEL_UNAVAILABLE'
  | 'INFERENCE_TIMEOUT'
  | 'INTERNAL_INFERENCE_ERROR';

/**
 * Base abstract domain error for all errors occurring within the Inference Service.
 */
export class InferenceError extends Error {
  public readonly code: InferenceErrorCode;
  public readonly statusCode: number;
  public readonly isRetryable: boolean;
  public readonly correlationId: string;
  public readonly details?: unknown;
  public readonly canonicalModelId?: string | undefined;

  constructor(
    code: InferenceErrorCode,
    message: string,
    statusCode: number,
    isRetryable: boolean,
    details?: unknown,
    canonicalModelId?: string | undefined,
    correlationId = '',
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    this.details = details;
    this.canonicalModelId = canonicalModelId;
    this.correlationId = correlationId;
  }
}

export class InvalidRequestError extends InferenceError {
  constructor(message: string, correlationId = '', details?: unknown) {
    super('INVALID_REQUEST', message, 400, false, details, undefined, correlationId);
  }
}

export class AuthenticationError extends InferenceError {
  constructor(message = 'Authentication required', correlationId = '') {
    super('AUTHENTICATION_ERROR', message, 401, false, undefined, undefined, correlationId);
  }
}

export class ForbiddenError extends InferenceError {
  constructor(message = 'Access forbidden for service identity', correlationId = '') {
    super('FORBIDDEN', message, 403, false, undefined, undefined, correlationId);
  }
}

export class ContextWindowExceededError extends InferenceError {
  constructor(message: string, canonicalModelId: string, correlationId = '', details?: unknown) {
    super('CONTEXT_WINDOW_EXCEEDED', message, 422, false, details, canonicalModelId, correlationId);
  }
}

export class UnsupportedEffortLevelError extends InferenceError {
  constructor(
    canonicalModelId: string,
    effort: string,
    supportedLevels?: readonly string[] | undefined,
    correlationId = '',
  ) {
    super(
      'UNSUPPORTED_EFFORT_LEVEL',
      `Model '${canonicalModelId}' does not support reasoning effort level '${effort}'. Supported levels: ${supportedLevels?.join(', ') || 'none'}`,
      422,
      false,
      { canonicalModelId, effort, supportedLevels },
      canonicalModelId,
      correlationId,
    );
  }
}

export class RequestCancelledError extends InferenceError {
  constructor(message = 'Inference request was cancelled by the caller.', correlationId = '') {
    super('REQUEST_CANCELLED', message, 499, false, undefined, undefined, correlationId);
  }
}

export class AllTargetsExhaustedError extends InferenceError {
  constructor(message: string, correlationId = '', details?: unknown) {
    super('ALL_TARGETS_EXHAUSTED', message, 503, true, details, undefined, correlationId);
  }
}

export class ModelUnavailableError extends InferenceError {
  constructor(
    canonicalModelId: string,
    message = `Model '${canonicalModelId}' is currently unavailable`,
    correlationId = '',
    details?: unknown,
  ) {
    super('MODEL_UNAVAILABLE', message, 503, true, details, canonicalModelId, correlationId);
  }
}

export class InferenceTimeoutError extends InferenceError {
  constructor(timeoutMs: number, correlationId = '', details?: unknown) {
    super(
      'INFERENCE_TIMEOUT',
      `Inference execution exceeded deadline: execution timed out after ${timeoutMs}ms`,
      504,
      true,
      details ?? { timeoutMs },
      undefined,
      correlationId,
    );
  }
}

export class InternalInferenceError extends InferenceError {
  constructor(
    message = 'An unexpected internal error occurred during inference execution',
    correlationId = '',
    details?: unknown,
  ) {
    super('INTERNAL_INFERENCE_ERROR', message, 500, false, details, undefined, correlationId);
  }
}
