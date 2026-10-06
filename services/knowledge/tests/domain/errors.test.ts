import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ChunkingFailedError,
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  DeadlineExceededError,
  DocumentAlreadyExistsError,
  DocumentNotFoundError,
  DocumentNotReadyError,
  EmbeddingUnavailableError,
  ExtractionFailedError,
  ForbiddenError,
  InternalKnowledgeError,
  InvalidRequestError,
  KnowledgeError,
  RequestCancelledError,
  TenantMismatchError,
  TenantPurgeFailedError,
  VectorStoreUnavailableError,
} from '../../src/domain/errors.js';

describe('Domain Errors - Knowledge Service', () => {
  it('correctly sets error codes, status codes and inheritance', () => {
    const errs: Array<[KnowledgeError, string, number]> = [
      [new CollectionNotFoundError('col-1'), 'COLLECTION_NOT_FOUND', 404],
      [new CollectionAlreadyExistsError('col-1'), 'COLLECTION_ALREADY_EXISTS', 409],
      [new DocumentNotFoundError('doc-1'), 'DOCUMENT_NOT_FOUND', 404],
      [new DocumentNotReadyError('doc-1', 'processing'), 'DOCUMENT_NOT_READY', 409],
      [new DocumentAlreadyExistsError('hash123'), 'DOCUMENT_ALREADY_EXISTS', 409],
      [new ExtractionFailedError('unsupported format'), 'EXTRACTION_FAILED', 422],
      [new ChunkingFailedError('token limit exceeded'), 'CHUNKING_FAILED', 422],
      [new EmbeddingUnavailableError(), 'EMBEDDING_UNAVAILABLE', 503],
      [new VectorStoreUnavailableError(), 'VECTOR_STORE_UNAVAILABLE', 503],
      [new TenantMismatchError(), 'FORBIDDEN', 403],
      [new InvalidRequestError('bad query'), 'INVALID_REQUEST', 400],
      [new DeadlineExceededError(), 'DEADLINE_EXCEEDED', 504],
      [new RequestCancelledError(), 'REQUEST_CANCELLED', 499],
      [new AuthenticationError(), 'AUTHENTICATION_ERROR', 401],
      [new ForbiddenError(), 'FORBIDDEN', 403],
      [new TenantPurgeFailedError('purge failed'), 'TENANT_PURGE_FAILED', 500],
      [new InternalKnowledgeError(), 'INTERNAL_KNOWLEDGE_ERROR', 500],
    ];

    for (const [err, code, statusCode] of errs) {
      expect(err).toBeInstanceOf(KnowledgeError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(statusCode);
    }
  });
});
