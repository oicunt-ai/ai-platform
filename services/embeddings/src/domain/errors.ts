export abstract class EmbeddingsError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public abstract readonly retryable: boolean;
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidRequestError extends EmbeddingsError {
  public readonly code = 'INVALID_REQUEST';
  public readonly statusCode = 400;
  public readonly retryable = false;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class EmptyInputError extends EmbeddingsError {
  public readonly code = 'EMPTY_INPUT';
  public readonly statusCode = 400;
  public readonly retryable = false;

  constructor(message = 'The inputs array must not be empty', details?: unknown) {
    super(message, details);
  }
}

export class EmptyInputItemError extends EmbeddingsError {
  public readonly code = 'EMPTY_INPUT_ITEM';
  public readonly statusCode = 400;
  public readonly retryable = false;

  constructor(index: number, details?: unknown) {
    super(`Input text at index ${index} must not be empty or whitespace only`, details);
  }
}

export class InputTooLargeError extends EmbeddingsError {
  public readonly code = 'INPUT_TOO_LARGE';
  public readonly statusCode = 400;
  public readonly retryable = false;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class BatchTooLargeError extends EmbeddingsError {
  public readonly code = 'BATCH_TOO_LARGE';
  public readonly statusCode = 400;
  public readonly retryable = false;

  constructor(actual: number, max: number, details?: unknown) {
    super(`Batch size of ${actual} items exceeds the maximum permitted limit of ${max}`, details);
  }
}

export class UnsupportedModelError extends EmbeddingsError {
  public readonly code = 'UNSUPPORTED_MODEL';
  public readonly statusCode = 404;
  public readonly retryable = false;

  constructor(model: string, details?: unknown) {
    super(`Embedding model '${model}' is not registered or cannot be resolved`, details);
  }
}

export class UnsupportedCapabilityError extends EmbeddingsError {
  public readonly code = 'UNSUPPORTED_CAPABILITY';
  public readonly statusCode = 400;
  public readonly retryable = false;

  constructor(model: string, modality = 'embedding', details?: unknown) {
    super(
      `Model '${model}' does not support required modality '${modality}'. Only embedding models are permitted.`,
      details,
    );
  }
}

export class InvalidDimensionsError extends EmbeddingsError {
  public readonly code = 'INVALID_DIMENSIONS';
  public readonly statusCode = 400;
  public readonly retryable = false;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class AuthenticationError extends EmbeddingsError {
  public readonly code = 'AUTHENTICATION_ERROR';
  public readonly statusCode = 401;
  public readonly retryable = false;

  constructor(message = 'Missing or invalid service authorization token', details?: unknown) {
    super(message, details);
  }
}

export class ForbiddenError extends EmbeddingsError {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;
  public readonly retryable = false;

  constructor(
    message = 'Access forbidden for requesting service identity or tenant',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class RateLimitedError extends EmbeddingsError {
  public readonly code = 'RATE_LIMITED';
  public readonly statusCode = 429;
  public readonly retryable = true;

  constructor(message = 'Embedding generation rate limit exceeded', details?: unknown) {
    super(message, details);
  }
}

export class RequestCancelledError extends EmbeddingsError {
  public readonly code = 'REQUEST_CANCELLED';
  public readonly statusCode = 499;
  public readonly retryable = false;

  constructor(message = 'Embedding request was cancelled by the caller', details?: unknown) {
    super(message, details);
  }
}

export class DeadlineExceededError extends EmbeddingsError {
  public readonly code = 'DEADLINE_EXCEEDED';
  public readonly statusCode = 504;
  public readonly retryable = true;

  constructor(
    message = 'Execution exceeded caller deadline or internal timeout budget',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class ModelUnavailableError extends EmbeddingsError {
  public readonly code = 'MODEL_UNAVAILABLE';
  public readonly statusCode = 503;
  public readonly retryable = true;

  constructor(
    message = 'Embedding model targets are currently unavailable or degraded',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class ProviderExecutionFailedError extends EmbeddingsError {
  public readonly code = 'PROVIDER_EXECUTION_FAILED';
  public readonly statusCode = 502;
  public readonly retryable: boolean = true;

  constructor(
    message = 'Provider execution failed during embedding generation',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class DimensionMismatchError extends ProviderExecutionFailedError {
  public override readonly code = 'PROVIDER_EXECUTION_FAILED';
  public override readonly statusCode = 502;
  public override readonly retryable: boolean = false;

  constructor(expected: number, actual: number, index: number, details?: unknown) {
    super(
      `Vector dimension mismatch: vector at index ${index} has ${actual} dimensions, expected ${expected}. Dimension coercion/padding is forbidden.`,
      details,
    );
  }
}

export class InternalEmbeddingError extends EmbeddingsError {
  public readonly code = 'INTERNAL_EMBEDDING_ERROR';
  public readonly statusCode = 500;
  public readonly retryable = false;

  constructor(message = 'Internal error in Embeddings Service', details?: unknown) {
    super(message, details);
  }
}
