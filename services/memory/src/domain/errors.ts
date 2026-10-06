export abstract class MemoryError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConversationNotFoundError extends MemoryError {
  public readonly code = 'CONVERSATION_NOT_FOUND';
  public readonly statusCode = 404;

  constructor(conversationId: string, details?: unknown) {
    super(`Conversation '${conversationId}' not found`, details);
  }
}

export class ConversationDeletedError extends MemoryError {
  public readonly code = 'CONVERSATION_DELETED';
  public readonly statusCode = 410;

  constructor(conversationId: string, details?: unknown) {
    super(`Conversation '${conversationId}' has been deleted and cannot be modified`, details);
  }
}

export class TenantMismatchError extends MemoryError {
  public readonly code = 'TENANT_MISMATCH';
  public readonly statusCode = 403;

  constructor(message = 'Access denied: Tenant isolation policy violation', details?: unknown) {
    super(message, details);
  }
}

export class UserMismatchError extends MemoryError {
  public readonly code = 'USER_MISMATCH';
  public readonly statusCode = 403;

  constructor(message = 'Access denied: User ownership verification failed', details?: unknown) {
    super(message, details);
  }
}

export class InvalidRequestError extends MemoryError {
  public readonly code = 'INVALID_REQUEST';
  public readonly statusCode = 400;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class SequenceConflictError extends MemoryError {
  public readonly code = 'SEQUENCE_CONFLICT';
  public readonly statusCode = 409;

  constructor(
    message = 'Sequence number conflict detected during concurrent write',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class StorageTimeoutError extends MemoryError {
  public readonly code = 'STORAGE_TIMEOUT';
  public readonly statusCode = 504;

  constructor(
    message = 'Memory storage operation timed out against monotonic deadline',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class RequestCancelledError extends MemoryError {
  public readonly code = 'REQUEST_CANCELLED';
  public readonly statusCode = 499;

  constructor(message = 'Request cancelled by caller', details?: unknown) {
    super(message, details);
  }
}

export class AuthenticationError extends MemoryError {
  public readonly code = 'AUTHENTICATION_ERROR';
  public readonly statusCode = 401;

  constructor(message = 'Missing or invalid service authorization token', details?: unknown) {
    super(message, details);
  }
}

export class ForbiddenError extends MemoryError {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;

  constructor(
    message = 'Service identity is not authorized to perform this operation',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class InternalMemoryError extends MemoryError {
  public readonly code = 'INTERNAL_MEMORY_ERROR';
  public readonly statusCode = 500;

  constructor(
    message = 'An unexpected internal error occurred in Memory Service',
    details?: unknown,
  ) {
    super(message, details);
  }
}
