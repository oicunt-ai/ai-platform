import type { IncomingMessage, ServerResponse } from 'node:http';
import { DeadlineExceededError, InvalidRequestError, KnowledgeError } from '../../domain/index.js';
import type { RequestContext } from './context.js';

export function checkDeadline(context: RequestContext): void {
  if (context.deadlineMs !== undefined && Date.now() >= context.deadlineMs) {
    throw new DeadlineExceededError(
      `Monotonic deadline of ${context.deadlineMs}ms exceeded prior to operation completion`,
    );
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
  const isKnowledgeError = err instanceof KnowledgeError;
  const statusCode = isKnowledgeError ? err.statusCode : 500;
  const code = isKnowledgeError ? err.code : 'INTERNAL_KNOWLEDGE_ERROR';
  const message = err instanceof Error ? err.message : 'An unexpected internal error occurred';
  const details = isKnowledgeError ? err.details : undefined;

  const payload = {
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
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
