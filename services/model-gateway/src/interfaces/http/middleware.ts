import type { IncomingMessage, ServerResponse } from 'node:http';
import { GatewayError } from '../../domain/errors.js';
import type { RequestContext } from './context.js';

export function sendJsonResponse(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
  context?: RequestContext,
): void {
  const payload = {
    success: true,
    data,
    meta: {
      requestId: context?.requestId,
      correlationId: context?.correlationId,
      timestamp: new Date().toISOString(),
    },
  };

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-ID': context?.requestId ?? '',
    'X-Correlation-ID': context?.correlationId ?? '',
  });
  res.end(JSON.stringify(payload));
}

export function sendErrorResponse(
  res: ServerResponse,
  error: unknown,
  context?: RequestContext,
): void {
  let statusCode = 500;
  let code = 'INTERNAL_GATEWAY_ERROR';
  let message = 'Internal AI platform execution failure.';
  let details: unknown = undefined;

  if (error instanceof GatewayError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof Error) {
    if (error.name === 'SyntaxError') {
      statusCode = 400;
      code = 'INVALID_JSON_BODY';
      message = 'Request body contains invalid JSON.';
    } else if (error.message.includes('Payload too large')) {
      statusCode = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'Request payload exceeds maximum allowed size.';
    } else if (error.message === 'Empty request body') {
      statusCode = 400;
      code = 'INVALID_REQUEST';
      message = 'Request body must not be empty.';
    }
  }

  const payload = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      requestId: context?.requestId,
      correlationId: context?.correlationId,
      timestamp: new Date().toISOString(),
    },
  };

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-ID': context?.requestId ?? '',
    'X-Correlation-ID': context?.correlationId ?? '',
  });
  res.end(JSON.stringify(payload));
}

export async function parseJsonBody<T>(
  req: IncomingMessage,
  maxBodySizeBytes = 1048576, // 1MB default
): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    let exceeded = false;

    req.on('data', (chunk: Buffer) => {
      if (exceeded) {
        return;
      }
      bytes += chunk.length;
      if (bytes > maxBodySizeBytes) {
        exceeded = true;
        req.resume();
        reject(new Error(`Payload too large. Exceeded limit of ${maxBodySizeBytes} bytes`));
        return;
      }
      raw += chunk.toString('utf-8');
    });

    req.on('end', () => {
      if (exceeded) {
        return;
      }
      if (!raw || raw.trim().length === 0) {
        reject(new Error('Empty request body'));
        return;
      }
      try {
        resolve(JSON.parse(raw) as T);
      } catch (err: unknown) {
        reject(err);
      }
    });

    req.on('error', (err: unknown) => {
      if (!exceeded) {
        reject(err);
      }
    });
  });
}
