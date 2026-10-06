import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  ConfirmationRequiredError,
  ConflictError,
  DeadlineExceededError,
  InternalToolError,
  InvalidToolArgumentsError,
  MalformedToolResultError,
  PermissionDeniedError,
  RequestCancelledError,
  SandboxSecurityViolationError,
  ToolDisabledError,
  ToolExecutionFailedError,
  ToolNotFoundError,
  ToolPlatformError,
  ToolRateLimitedError,
  ToolUnavailableError,
  ToolVersionMismatchError,
} from '../../src/domain/index.js';

describe('Tools Error Taxonomy', () => {
  it('correctly maps error codes, status codes, and retryable semantics', () => {
    const invalidArgs = new InvalidToolArgumentsError('bad args');
    expect(invalidArgs).toBeInstanceOf(ToolPlatformError);
    expect(invalidArgs.code).toBe('INVALID_TOOL_ARGUMENTS');
    expect(invalidArgs.statusCode).toBe(400);
    expect(invalidArgs.retryable).toBe(false);

    const notFound = new ToolNotFoundError('not found');
    expect(notFound.code).toBe('TOOL_NOT_FOUND');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.retryable).toBe(false);

    const versionMismatch = new ToolVersionMismatchError('mismatch');
    expect(versionMismatch.code).toBe('TOOL_VERSION_MISMATCH');
    expect(versionMismatch.statusCode).toBe(400);

    const disabled = new ToolDisabledError('disabled');
    expect(disabled.code).toBe('TOOL_DISABLED');
    expect(disabled.statusCode).toBe(403);

    const permDenied = new PermissionDeniedError('forbidden');
    expect(permDenied.code).toBe('PERMISSION_DENIED');
    expect(permDenied.statusCode).toBe(403);

    const confRequired = new ConfirmationRequiredError('confirmation needed', {
      challengeToken: 'tok_1',
      toolId: 'oicunt.tool.action',
      version: '1.0.0',
      argumentsHash: 'hash',
      expiresAt: '2026-10-06T00:00:00Z',
    });
    expect(confRequired.code).toBe('CONFIRMATION_REQUIRED');
    expect(confRequired.statusCode).toBe(403);
    expect(confRequired.challenge.challengeToken).toBe('tok_1');

    const authError = new AuthenticationError('unauthorized');
    expect(authError.code).toBe('AUTHENTICATION_ERROR');
    expect(authError.statusCode).toBe(401);

    const rateLimited = new ToolRateLimitedError('rate limited');
    expect(rateLimited.code).toBe('TOOL_RATE_LIMITED');
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.retryable).toBe(true);

    const cancelled = new RequestCancelledError('cancelled');
    expect(cancelled.code).toBe('REQUEST_CANCELLED');
    expect(cancelled.statusCode).toBe(499);

    const deadlineExceeded = new DeadlineExceededError('deadline exceeded', true);
    expect(deadlineExceeded.code).toBe('DEADLINE_EXCEEDED');
    expect(deadlineExceeded.statusCode).toBe(504);
    expect(deadlineExceeded.retryable).toBe(true); // retryable if read-only

    const unavailable = new ToolUnavailableError('service down');
    expect(unavailable.code).toBe('TOOL_UNAVAILABLE');
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.retryable).toBe(true);

    const execFailed = new ToolExecutionFailedError('failed', false);
    expect(execFailed.code).toBe('TOOL_EXECUTION_FAILED');
    expect(execFailed.statusCode).toBe(502);
    expect(execFailed.retryable).toBe(false);

    const malformedResult = new MalformedToolResultError('malformed');
    expect(malformedResult.code).toBe('MALFORMED_TOOL_RESULT');
    expect(malformedResult.statusCode).toBe(502);

    const sandboxViolation = new SandboxSecurityViolationError('violation');
    expect(sandboxViolation.code).toBe('SANDBOX_SECURITY_VIOLATION');
    expect(sandboxViolation.statusCode).toBe(403);

    const conflict = new ConflictError('conflict');
    expect(conflict.code).toBe('CONFLICT_ERROR');
    expect(conflict.statusCode).toBe(409);

    const internal = new InternalToolError('internal error');
    expect(internal.code).toBe('INTERNAL_TOOL_ERROR');
    expect(internal.statusCode).toBe(500);
  });
});
