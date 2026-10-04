import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  AiDomainError,
  EntityNotFoundError,
  ValidationError,
  ConflictError,
  ModelNotFoundError,
} from '../../domain/index.js';

export interface RequestContext {
  readonly correlationId: string;
  readonly userId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly startTime: number;
}

export function extractHeader(req: IncomingMessage, headerName: string): string | undefined {
  const header = req.headers[headerName.toLowerCase()];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  if (Array.isArray(header) && header[0]) {
    return header[0].trim();
  }
  return undefined;
}

export function createRequestContext(req: IncomingMessage, res: ServerResponse): RequestContext {
  const correlationId = extractHeader(req, 'x-correlation-id') ?? randomUUID();
  const userId = extractHeader(req, 'x-user-id');
  const tenantId = extractHeader(req, 'x-tenant-id');

  res.setHeader('X-Correlation-ID', correlationId);

  return {
    correlationId,
    userId,
    tenantId,
    startTime: Date.now(),
  };
}

export function handleHttpError(
  res: ServerResponse,
  error: unknown,
  context: RequestContext,
): void {
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred while processing the request';

  if (error instanceof EntityNotFoundError) {
    statusCode = 404;
    code = error.code;
    message = error.message;
  } else if (error instanceof ModelNotFoundError) {
    statusCode = 404;
    code = error.code;
    message = error.message;
  } else if (error instanceof ValidationError) {
    statusCode = 400;
    code = error.code;
    message = error.message;
  } else if (error instanceof ConflictError) {
    statusCode = 409;
    code = error.code;
    message = error.message;
  } else if (error instanceof AiDomainError) {
    statusCode = 422;
    code = error.code;
    message = error.message;
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
