export abstract class ToolPlatformError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public abstract readonly retryable: boolean;
  public readonly details?: unknown | undefined;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidToolArgumentsError extends ToolPlatformError {
  public readonly code = 'INVALID_TOOL_ARGUMENTS';
  public readonly statusCode = 400;
  public readonly retryable = false;
}

export class ToolNotFoundError extends ToolPlatformError {
  public readonly code = 'TOOL_NOT_FOUND';
  public readonly statusCode = 404;
  public readonly retryable = false;
}

export class ToolVersionMismatchError extends ToolPlatformError {
  public readonly code = 'TOOL_VERSION_MISMATCH';
  public readonly statusCode = 400;
  public readonly retryable = false;
}

export class ToolDisabledError extends ToolPlatformError {
  public readonly code = 'TOOL_DISABLED';
  public readonly statusCode = 403;
  public readonly retryable = false;
}

export class PermissionDeniedError extends ToolPlatformError {
  public readonly code = 'PERMISSION_DENIED';
  public readonly statusCode = 403;
  public readonly retryable = false;
}

export class ConfirmationRequiredError extends ToolPlatformError {
  public readonly code = 'CONFIRMATION_REQUIRED';
  public readonly statusCode = 403;
  public readonly retryable = false;

  constructor(
    message: string,
    public readonly challenge: {
      readonly challengeToken: string;
      readonly toolId: string;
      readonly version: string;
      readonly argumentsHash: string;
      readonly expiresAt: string;
    },
  ) {
    super(message, challenge);
  }
}

export class AuthenticationError extends ToolPlatformError {
  public readonly code = 'AUTHENTICATION_ERROR';
  public readonly statusCode = 401;
  public readonly retryable = false;
}

export class ToolRateLimitedError extends ToolPlatformError {
  public readonly code = 'TOOL_RATE_LIMITED';
  public readonly statusCode = 429;
  public readonly retryable = true;
}

export class RequestCancelledError extends ToolPlatformError {
  public readonly code = 'REQUEST_CANCELLED';
  public readonly statusCode = 499;
  public readonly retryable = false;
}

export class DeadlineExceededError extends ToolPlatformError {
  public readonly code = 'DEADLINE_EXCEEDED';
  public readonly statusCode = 504;
  public readonly retryable: boolean;

  constructor(message: string, isReadOnly = false) {
    super(message);
    this.retryable = isReadOnly;
  }
}

export class ToolUnavailableError extends ToolPlatformError {
  public readonly code = 'TOOL_UNAVAILABLE';
  public readonly statusCode = 503;
  public readonly retryable = true;
}

export class ToolExecutionFailedError extends ToolPlatformError {
  public readonly code = 'TOOL_EXECUTION_FAILED';
  public readonly statusCode = 502;
  public readonly retryable: boolean;

  constructor(message: string, isReadOnly = false, details?: unknown) {
    super(message, details);
    this.retryable = isReadOnly;
  }
}

export class MalformedToolResultError extends ToolPlatformError {
  public readonly code = 'MALFORMED_TOOL_RESULT';
  public readonly statusCode = 502;
  public readonly retryable = false;
}

export class SandboxSecurityViolationError extends ToolPlatformError {
  public readonly code = 'SANDBOX_SECURITY_VIOLATION';
  public readonly statusCode = 403;
  public readonly retryable = false;
}

export class ConflictError extends ToolPlatformError {
  public readonly code = 'CONFLICT_ERROR';
  public readonly statusCode = 409;
  public readonly retryable = false;
}

export class InternalToolError extends ToolPlatformError {
  public readonly code = 'INTERNAL_TOOL_ERROR';
  public readonly statusCode = 500;
  public readonly retryable = false;
}
