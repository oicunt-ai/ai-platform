export abstract class KnowledgeError extends Error {
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

export class CollectionNotFoundError extends KnowledgeError {
  public readonly code = 'COLLECTION_NOT_FOUND';
  public readonly statusCode = 404;

  constructor(collectionId: string, details?: unknown) {
    super(`Collection '${collectionId}' not found`, details);
  }
}

export class CollectionAlreadyExistsError extends KnowledgeError {
  public readonly code = 'COLLECTION_ALREADY_EXISTS';
  public readonly statusCode = 409;

  constructor(name: string, details?: unknown) {
    super(`Collection with name '${name}' already exists in tenant`, details);
  }
}

export class DocumentNotFoundError extends KnowledgeError {
  public readonly code = 'DOCUMENT_NOT_FOUND';
  public readonly statusCode = 404;

  constructor(documentId: string, details?: unknown) {
    super(`Document '${documentId}' not found`, details);
  }
}

export class DocumentNotReadyError extends KnowledgeError {
  public readonly code = 'DOCUMENT_NOT_READY';
  public readonly statusCode = 409;

  constructor(documentId: string, status: string, details?: unknown) {
    super(`Document '${documentId}' is not ready for retrieval (status: '${status}')`, details);
  }
}

export class DocumentAlreadyExistsError extends KnowledgeError {
  public readonly code = 'DOCUMENT_ALREADY_EXISTS';
  public readonly statusCode = 409;

  constructor(documentHash: string, details?: unknown) {
    super(`Duplicate document with hash '${documentHash}' already exists in collection`, details);
  }
}

export class ExtractionFailedError extends KnowledgeError {
  public readonly code = 'EXTRACTION_FAILED';
  public readonly statusCode = 422;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class ChunkingFailedError extends KnowledgeError {
  public readonly code = 'CHUNKING_FAILED';
  public readonly statusCode = 422;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class EmbeddingUnavailableError extends KnowledgeError {
  public readonly code = 'EMBEDDING_UNAVAILABLE';
  public readonly statusCode = 503;

  constructor(message = 'Embedding service is unavailable or timed out', details?: unknown) {
    super(message, details);
  }
}

export class VectorStoreUnavailableError extends KnowledgeError {
  public readonly code = 'VECTOR_STORE_UNAVAILABLE';
  public readonly statusCode = 503;

  constructor(message = 'Vector store is unavailable or write timed out', details?: unknown) {
    super(message, details);
  }
}

export class TenantMismatchError extends KnowledgeError {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;

  constructor(message = 'Access denied: Tenant isolation policy violation', details?: unknown) {
    super(message, details);
  }
}

export class InvalidRequestError extends KnowledgeError {
  public readonly code = 'INVALID_REQUEST';
  public readonly statusCode = 400;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class DeadlineExceededError extends KnowledgeError {
  public readonly code = 'DEADLINE_EXCEEDED';
  public readonly statusCode = 504;

  constructor(
    message = 'Knowledge operation timed out against requested deadline',
    details?: unknown,
  ) {
    super(message, details);
  }
}

export class RequestCancelledError extends KnowledgeError {
  public readonly code = 'REQUEST_CANCELLED';
  public readonly statusCode = 499;

  constructor(message = 'Request cancelled by caller', details?: unknown) {
    super(message, details);
  }
}

export class AuthenticationError extends KnowledgeError {
  public readonly code = 'AUTHENTICATION_ERROR';
  public readonly statusCode = 401;

  constructor(message = 'Missing or invalid service authorization token', details?: unknown) {
    super(message, details);
  }
}

export class ForbiddenError extends KnowledgeError {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;

  constructor(message = 'Access forbidden for requesting service identity', details?: unknown) {
    super(message, details);
  }
}

export class TenantPurgeFailedError extends KnowledgeError {
  public readonly code = 'TENANT_PURGE_FAILED';
  public readonly statusCode = 500;

  constructor(message = 'Tenant purge job failed', details?: unknown) {
    super(message, details);
  }
}

export class InternalKnowledgeError extends KnowledgeError {
  public readonly code = 'INTERNAL_KNOWLEDGE_ERROR';
  public readonly statusCode = 500;

  constructor(message = 'Internal knowledge service error', details?: unknown) {
    super(message, details);
  }
}
