export type OrchestratorErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_EFFORT_LEVEL'
  | 'CONTEXT_WINDOW_EXCEEDED'
  | 'AUTHENTICATION_ERROR'
  | 'FORBIDDEN'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_DEPRECATED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'REQUEST_CANCELLED'
  | 'MODEL_IN_MAINTENANCE'
  | 'ALL_TARGETS_EXHAUSTED'
  | 'REGISTRY_UNAVAILABLE'
  | 'INFERENCE_TIMEOUT'
  | 'INTERNAL_ORCHESTRATOR_ERROR';

export interface OrchestratorErrorPayload {
  readonly code: OrchestratorErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly canonicalModelId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly details?: Record<string, unknown> | undefined;
}

export class OrchestratorError extends Error {
  public readonly code: OrchestratorErrorCode;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly canonicalModelId?: string | undefined;
  public readonly correlationId?: string | undefined;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: OrchestratorErrorCode,
    message: string,
    statusCode = 500,
    retryable = false,
    details?: Record<string, unknown>,
    canonicalModelId?: string,
    correlationId?: string,
  ) {
    super(message);
    this.name = 'OrchestratorError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
    this.canonicalModelId = canonicalModelId;
    this.correlationId = correlationId;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toPayload(): OrchestratorErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      canonicalModelId: this.canonicalModelId,
      correlationId: this.correlationId,
      details: this.details,
    };
  }
}

export class InvalidRequestError extends OrchestratorError {
  constructor(message: string, correlationId?: string, details?: Record<string, unknown>) {
    super('INVALID_REQUEST', message, 400, false, details, undefined, correlationId);
    this.name = 'InvalidRequestError';
  }
}

export class UnsupportedEffortLevelError extends OrchestratorError {
  constructor(
    canonicalModelId: string,
    effort?: string,
    supportedLevels?: readonly string[],
    correlationId?: string,
  ) {
    const msg = effort
      ? `Model '${canonicalModelId}' does not support reasoning effort '${effort}'.`
      : `Model '${canonicalModelId}' does not support reasoning effort.`;
    super(
      'UNSUPPORTED_EFFORT_LEVEL',
      msg,
      400,
      false,
      {
        model: canonicalModelId,
        requestedEffort: effort,
        supportedLevels: supportedLevels ?? [],
      },
      canonicalModelId,
      correlationId,
    );
    this.name = 'UnsupportedEffortLevelError';
  }
}

export class ContextWindowExceededError extends OrchestratorError {
  constructor(
    canonicalModelId: string,
    limit: number,
    estimatedTokens: number,
    correlationId?: string,
  ) {
    super(
      'CONTEXT_WINDOW_EXCEEDED',
      `The combined message context exceeds the model context window limit of ${limit} tokens.`,
      400,
      false,
      {
        model: canonicalModelId,
        limit,
        estimatedTokens,
      },
      canonicalModelId,
      correlationId,
    );
    this.name = 'ContextWindowExceededError';
  }
}

export class AuthenticationError extends OrchestratorError {
  constructor(
    message = 'Missing or invalid service authentication token.',
    correlationId?: string,
  ) {
    super('AUTHENTICATION_ERROR', message, 401, false, undefined, undefined, correlationId);
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends OrchestratorError {
  constructor(
    message = 'Calling service identity is not authorized to access AI Orchestrator.',
    correlationId?: string,
  ) {
    super('FORBIDDEN', message, 403, false, undefined, undefined, correlationId);
    this.name = 'ForbiddenError';
  }
}

export class ModelNotFoundError extends OrchestratorError {
  constructor(canonicalModelId: string, correlationId?: string) {
    super(
      'MODEL_NOT_FOUND',
      `Canonical model '${canonicalModelId}' was not found in the Model Registry.`,
      404,
      false,
      { model: canonicalModelId },
      canonicalModelId,
      correlationId,
    );
    this.name = 'ModelNotFoundError';
  }
}

export class ModelDeprecatedError extends OrchestratorError {
  constructor(canonicalModelId: string, correlationId?: string) {
    super(
      'MODEL_DEPRECATED',
      `Canonical model '${canonicalModelId}' has been permanently retired. Please select an active model from the catalog.`,
      410,
      false,
      { model: canonicalModelId },
      canonicalModelId,
      correlationId,
    );
    this.name = 'ModelDeprecatedError';
  }
}

export class RateLimitExceededError extends OrchestratorError {
  constructor(canonicalModelIdOrMessage: string, correlationId?: string) {
    super(
      'RATE_LIMIT_EXCEEDED',
      canonicalModelIdOrMessage.includes(' ')
        ? canonicalModelIdOrMessage
        : `Rate limit exceeded for model '${canonicalModelIdOrMessage}'.`,
      429,
      true,
      undefined,
      canonicalModelIdOrMessage.includes(' ') ? undefined : canonicalModelIdOrMessage,
      correlationId,
    );
    this.name = 'RateLimitExceededError';
  }
}

export class RequestCancelledError extends OrchestratorError {
  constructor(message = 'Inference request was cancelled by the caller.', correlationId?: string) {
    super('REQUEST_CANCELLED', message, 499, false, undefined, undefined, correlationId);
    this.name = 'RequestCancelledError';
  }
}

export class ModelInMaintenanceError extends OrchestratorError {
  constructor(canonicalModelId: string, correlationId?: string) {
    super(
      'MODEL_IN_MAINTENANCE',
      `Canonical model '${canonicalModelId}' is temporarily undergoing maintenance. Please select another model.`,
      503,
      true,
      { model: canonicalModelId },
      canonicalModelId,
      correlationId,
    );
    this.name = 'ModelInMaintenanceError';
  }
}

export class AllTargetsExhaustedError extends OrchestratorError {
  constructor(messageOrModel: string, correlationId?: string) {
    const isMessage = messageOrModel.includes(' ');
    super(
      'ALL_TARGETS_EXHAUSTED',
      isMessage
        ? messageOrModel
        : `All eligible provider execution targets for model '${messageOrModel}' are currently exhausted or unavailable.`,
      503,
      true,
      undefined,
      isMessage ? undefined : messageOrModel,
      correlationId,
    );
    this.name = 'AllTargetsExhaustedError';
  }
}

export class RegistryUnavailableError extends OrchestratorError {
  constructor(
    message = 'Model Registry control plane is unreachable or failing resolution.',
    correlationId?: string,
  ) {
    super('REGISTRY_UNAVAILABLE', message, 503, true, undefined, undefined, correlationId);
    this.name = 'RegistryUnavailableError';
  }
}

export class InferenceTimeoutError extends OrchestratorError {
  constructor(timeoutMsOrMessage?: number | string, correlationId?: string) {
    const msg =
      typeof timeoutMsOrMessage === 'number'
        ? `Inference request timed out after ${timeoutMsOrMessage}ms.`
        : typeof timeoutMsOrMessage === 'string'
          ? timeoutMsOrMessage
          : 'Inference request timed out across overall execution deadline.';
    super('INFERENCE_TIMEOUT', msg, 504, true, undefined, undefined, correlationId);
    this.name = 'InferenceTimeoutError';
  }
}

export class InternalOrchestratorError extends OrchestratorError {
  constructor(message = 'Internal AI platform orchestration failure.', correlationId?: string) {
    super('INTERNAL_ORCHESTRATOR_ERROR', message, 500, false, undefined, undefined, correlationId);
    this.name = 'InternalOrchestratorError';
  }
}
