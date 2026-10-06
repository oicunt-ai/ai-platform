import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ConversationDeletedError,
  ConversationNotFoundError,
  ForbiddenError,
  InternalMemoryError,
  InvalidRequestError,
  MemoryError,
  RequestCancelledError,
  SequenceConflictError,
  StorageTimeoutError,
  TenantMismatchError,
  UserMismatchError,
} from '../../src/domain/errors.js';

describe('Domain Errors', () => {
  it('correctly sets error codes, status codes and names', () => {
    const errs: Array<[MemoryError, string, number]> = [
      [new ConversationNotFoundError('c1'), 'CONVERSATION_NOT_FOUND', 404],
      [new ConversationDeletedError('c1'), 'CONVERSATION_DELETED', 410],
      [new TenantMismatchError(), 'TENANT_MISMATCH', 403],
      [new UserMismatchError(), 'USER_MISMATCH', 403],
      [new InvalidRequestError('bad input'), 'INVALID_REQUEST', 400],
      [new SequenceConflictError(), 'SEQUENCE_CONFLICT', 409],
      [new StorageTimeoutError(), 'STORAGE_TIMEOUT', 504],
      [new RequestCancelledError(), 'REQUEST_CANCELLED', 499],
      [new AuthenticationError(), 'AUTHENTICATION_ERROR', 401],
      [new ForbiddenError(), 'FORBIDDEN', 403],
      [new InternalMemoryError(), 'INTERNAL_MEMORY_ERROR', 500],
    ];

    for (const [err, code, statusCode] of errs) {
      expect(err).toBeInstanceOf(MemoryError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(statusCode);
    }
  });
});
