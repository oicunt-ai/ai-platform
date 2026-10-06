import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AgentDomainError,
  DeadlineExceededError,
  InvalidRequestError,
} from '../../domain/errors.js';
import type { RequestContext } from './context.js';

export function checkDeadline(context: RequestContext): void {
  if (context.deadlineMs !== undefined && Date.now() >= context.deadlineMs) {
    throw new DeadlineExceededError(context.correlationId, context.deadlineMs);
  }
}

export async function parseJsonBody<T>(
  req: IncomingMessage,
  maxSizeBytes = 10_485_760, // 10MB
): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytesReceived = 0;

    req.on('data', (chunk: Buffer) => {
      bytesReceived += chunk.length;
      if (bytesReceived > maxSizeBytes) {
        req.destroy();
        reject(
          new InvalidRequestError(
            `Request body exceeds maximum allowed size of ${maxSizeBytes} bytes`,
          ),
        );
        return;
      }
      raw += chunk.toString('utf-8');
    });

    req.on('end', () => {
      if (!raw.trim()) {
        resolve({} as T);
        return;
      }

      try {
        const parsed = JSON.parse(raw) as T;
        resolve(parsed);
      } catch (err: unknown) {
        reject(
          new InvalidRequestError(
            `Malformed JSON body: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

export function sendJsonResponse<T>(
  res: ServerResponse,
  statusCode: number,
  data: T,
  context?: RequestContext,
): void {
  const payload = {
    success: true,
    data,
    meta: {
      requestId: context?.requestId ?? '',
      correlationId: context?.correlationId ?? '',
      timestamp: new Date().toISOString(),
    },
  };

  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Request-ID': context?.requestId ?? '',
    'X-Correlation-ID': context?.correlationId ?? '',
  });
  res.end(body);
}

export function sendErrorResponse(
  res: ServerResponse,
  err: unknown,
  context?: RequestContext,
): void {
  const isAgentDomainError = err instanceof AgentDomainError;
  const statusCode = isAgentDomainError ? err.statusCode : 500;
  const code = isAgentDomainError ? err.code : 'INTERNAL_AGENT_ERROR';
  const message = err instanceof Error ? err.message : 'An unexpected internal error occurred';
  const retryable = isAgentDomainError ? err.retryable : false;
  const details = isAgentDomainError ? err.details : undefined;

  const payload = {
    success: false,
    error: {
      code,
      message,
      retryable,
      ...(details !== undefined ? { details } : {}),
    },
    meta: {
      requestId: context?.requestId ?? '',
      correlationId: context?.correlationId ?? '',
      timestamp: new Date().toISOString(),
    },
  };

  const body = JSON.stringify(payload);
  if (!res.headersSent) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Request-ID': context?.requestId ?? '',
      'X-Correlation-ID': context?.correlationId ?? '',
    });
  }
  res.end(body);
}

export function setupSseResponse(res: ServerResponse, context?: RequestContext): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Request-ID': context?.requestId ?? '',
    'X-Correlation-ID': context?.correlationId ?? '',
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

export function sendSseEvent(
  res: ServerResponse,
  event: string,
  data: Record<string, unknown>,
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
