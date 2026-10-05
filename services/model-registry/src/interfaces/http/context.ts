import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  readonly correlationId: string;
  readonly serviceName?: string | undefined;
  readonly actorId?: string | undefined;
  readonly changeReason?: string | undefined;
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
  const serviceName = extractHeader(req, 'x-service-name');
  const actorId = extractHeader(req, 'x-actor-id');
  const changeReason = extractHeader(req, 'x-change-reason');
  const tenantId = extractHeader(req, 'x-tenant-id');

  res.setHeader('X-Correlation-ID', correlationId);

  return {
    correlationId,
    serviceName,
    actorId,
    changeReason,
    tenantId,
    startTime: Date.now(),
  };
}

export class PayloadTooLargeError extends Error {
  public readonly code = 'PAYLOAD_TOO_LARGE';
  public readonly statusCode = 413;

  constructor(limitBytes: number) {
    super(`Request payload exceeds maximum allowed size of ${limitBytes} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

export async function parseJsonBody<T>(
  req: IncomingMessage,
  maxBodySizeBytes: number = 1048576,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let receivedBytes = 0;
    let exceeded = false;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      if (exceeded) {
        return;
      }
      receivedBytes += chunk.length;
      if (receivedBytes > maxBodySizeBytes) {
        exceeded = true;
        req.resume();
        reject(new PayloadTooLargeError(maxBodySizeBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (exceeded) {
        return;
      }
      if (chunks.length === 0) {
        resolve({} as T);
        return;
      }
      try {
        const bodyStr = Buffer.concat(chunks).toString('utf-8');
        const parsed = JSON.parse(bodyStr) as T;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
    req.on('error', (err) => {
      if (!exceeded) {
        reject(err);
      }
    });
  });
}
