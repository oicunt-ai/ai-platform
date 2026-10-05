export type GatewayErrorCode =
  | 'RATE_LIMIT_EXCEEDED'
  | 'CONTEXT_WINDOW_EXCEEDED'
  | 'PROVIDER_AUTHENTICATION_ERROR'
  | 'CONTENT_POLICY_VIOLATION'
  | 'MODEL_UNAVAILABLE'
  | 'INFERENCE_TIMEOUT'
  | 'UNSUPPORTED_EFFORT_LEVEL'
  | 'UNSUPPORTED_CAPABILITY'
  | 'INVALID_REQUEST'
  | 'STREAM_INTERRUPTED'
  | 'REQUEST_CANCELLED'
  | 'ALL_TARGETS_EXHAUSTED'
  | 'INTERNAL_GATEWAY_ERROR';

export interface GatewayErrorPayload {
  readonly code: GatewayErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly canonicalModelId: string;
  readonly targetId?: string | undefined;
  readonly correlationId: string;
  readonly details?: Record<string, unknown> | undefined;
}

export class GatewayError extends Error {
  public readonly code: GatewayErrorCode;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly canonicalModelId: string;
  public readonly targetId?: string | undefined;
  public readonly correlationId: string;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(params: {
    code: GatewayErrorCode;
    statusCode: number;
    message: string;
    retryable: boolean;
    canonicalModelId: string;
    correlationId: string;
    targetId?: string | undefined;
    details?: Record<string, unknown> | undefined;
  }) {
    super(params.message);
    this.name = 'GatewayError';
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.retryable = params.retryable;
    this.canonicalModelId = params.canonicalModelId;
    this.targetId = params.targetId;
    this.correlationId = params.correlationId;
    this.details = params.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toPayload(): GatewayErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      canonicalModelId: this.canonicalModelId,
      targetId: this.targetId,
      correlationId: this.correlationId,
      details: this.details,
    };
  }
}

export class RateLimitExceededError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string, targetId?: string) {
    super({
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      message: 'Model throughput limits exceeded. Please retry momentarily.',
      retryable: true,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class ContextWindowExceededError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string, details?: Record<string, unknown>) {
    super({
      code: 'CONTEXT_WINDOW_EXCEEDED',
      statusCode: 400,
      message: 'Prompt exceeds maximum allowed context window.',
      retryable: false,
      canonicalModelId,
      correlationId,
      details,
    });
  }
}

export class ProviderAuthenticationError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string, targetId?: string) {
    // Zero secret or raw provider leakage
    super({
      code: 'PROVIDER_AUTHENTICATION_ERROR',
      statusCode: 500,
      message: 'Model service configuration error.',
      retryable: false,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class ContentPolicyViolationError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string, targetId?: string) {
    super({
      code: 'CONTENT_POLICY_VIOLATION',
      statusCode: 422,
      message: 'Prompt or completion triggered content safety policies.',
      retryable: false,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class ModelUnavailableError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string, targetId?: string) {
    super({
      code: 'MODEL_UNAVAILABLE',
      statusCode: 503,
      message: 'Model provider is currently experiencing downtime.',
      retryable: true,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class InferenceTimeoutError extends GatewayError {
  constructor(
    canonicalModelId: string,
    correlationId: string,
    targetId?: string,
    message = 'Model inference timed out.',
  ) {
    super({
      code: 'INFERENCE_TIMEOUT',
      statusCode: 504,
      message,
      retryable: false,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class UnsupportedEffortLevelError extends GatewayError {
  constructor(canonicalModelId: string, effort: string, correlationId: string, targetId?: string) {
    super({
      code: 'UNSUPPORTED_EFFORT_LEVEL',
      statusCode: 400,
      message: `Selected model does not support reasoning effort '${effort}'.`,
      retryable: false,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class UnsupportedCapabilityError extends GatewayError {
  constructor(
    canonicalModelId: string,
    capability: string,
    correlationId: string,
    targetId?: string,
  ) {
    super({
      code: 'UNSUPPORTED_CAPABILITY',
      statusCode: 400,
      message: `Selected model does not support capability '${capability}'.`,
      retryable: false,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class InvalidRequestError extends GatewayError {
  constructor(
    canonicalModelId: string,
    message: string,
    correlationId: string,
    details?: Record<string, unknown>,
  ) {
    super({
      code: 'INVALID_REQUEST',
      statusCode: 400,
      message,
      retryable: false,
      canonicalModelId,
      correlationId,
      details,
    });
  }
}

export class StreamInterruptedError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string, targetId?: string) {
    super({
      code: 'STREAM_INTERRUPTED',
      statusCode: 502,
      message: 'Model response stream was interrupted prematurely.',
      retryable: false,
      canonicalModelId,
      correlationId,
      targetId,
    });
  }
}

export class RequestCancelledError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string) {
    super({
      code: 'REQUEST_CANCELLED',
      statusCode: 499,
      message: 'Inference request was cancelled by caller.',
      retryable: false,
      canonicalModelId,
      correlationId,
    });
  }
}

export class AllTargetsExhaustedError extends GatewayError {
  constructor(canonicalModelId: string, correlationId: string) {
    super({
      code: 'ALL_TARGETS_EXHAUSTED',
      statusCode: 503,
      message: 'All providers for this model are currently unavailable.',
      retryable: false,
      canonicalModelId,
      correlationId,
    });
  }
}

export class InternalGatewayError extends GatewayError {
  constructor(
    canonicalModelId: string,
    correlationId: string,
    message = 'Internal AI platform execution failure.',
  ) {
    super({
      code: 'INTERNAL_GATEWAY_ERROR',
      statusCode: 500,
      message,
      retryable: false,
      canonicalModelId,
      correlationId,
    });
  }
}
