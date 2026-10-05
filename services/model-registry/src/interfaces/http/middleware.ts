import type { ServerResponse } from 'node:http';
import {
  AliasCycleDetectedError,
  ImmutableVersionViolationError,
  InvalidRoutingPolicyError,
  ModelDeprecatedError,
  ModelInMaintenanceError,
  ModelNotFoundError,
  ModelValidationError,
  NoEligibleTargetsError,
  OptimisticLockError,
  VersionNotFoundError,
} from '../../domain/index.js';
import type { RequestContext } from './context.js';
import { PayloadTooLargeError } from './context.js';
import { ForbiddenError, UnauthorizedError } from './auth.js';

export function sendJsonResponse<T>(
  res: ServerResponse,
  statusCode: number,
  data: T,
  context: RequestContext,
): void {
  const payload = {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      correlationId: context.correlationId,
      executionTimeMs: Date.now() - context.startTime,
    },
  };

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

export function handleHttpError(
  res: ServerResponse,
  error: unknown,
  context: RequestContext,
): void {
  let statusCode: number;
  let code: string;
  let message: string;

  if (error instanceof ModelNotFoundError) {
    statusCode = 404;
    code = error.code;
    message = error.message;
  } else if (error instanceof VersionNotFoundError) {
    statusCode = 404;
    code = error.code;
    message = error.message;
  } else if (error instanceof ModelDeprecatedError) {
    statusCode = 410;
    code = error.code;
    message = error.message;
  } else if (error instanceof ModelInMaintenanceError) {
    statusCode = 503;
    code = error.code;
    message = error.message;
  } else if (error instanceof NoEligibleTargetsError) {
    statusCode = 503;
    code = error.code;
    message = error.message;
  } else if (error instanceof InvalidRoutingPolicyError) {
    statusCode = 400;
    code = error.code;
    message = error.message;
  } else if (error instanceof AliasCycleDetectedError) {
    statusCode = 400;
    code = error.code;
    message = error.message;
  } else if (error instanceof ImmutableVersionViolationError) {
    statusCode = 409;
    code = error.code;
    message = error.message;
  } else if (error instanceof OptimisticLockError) {
    statusCode = 409;
    code = error.code;
    message = error.message;
  } else if (error instanceof ModelValidationError) {
    statusCode = 400;
    code = error.code;
    message = error.message;
  } else if (error instanceof UnauthorizedError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
  } else if (error instanceof ForbiddenError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
  } else if (error instanceof PayloadTooLargeError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
  } else if (error instanceof Error && error.message.startsWith('Invalid JSON body')) {
    statusCode = 400;
    code = 'INVALID_JSON_BODY';
    message = error.message;
  } else {
    // Sanitize unexpected internal/database errors to prevent leaking internal SQL/driver details
    statusCode = 500;
    code = 'INTERNAL_SERVER_ERROR';
    message = 'An unexpected internal error occurred';
    console.error(`[INTERNAL_SERVER_ERROR] [CorrelationID: ${context.correlationId}]`, error);
  }

  const payload = {
    success: false,
    error: {
      code,
      message,
    },
    meta: {
      timestamp: new Date().toISOString(),
      correlationId: context.correlationId,
      executionTimeMs: Date.now() - context.startTime,
    },
  };

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}
