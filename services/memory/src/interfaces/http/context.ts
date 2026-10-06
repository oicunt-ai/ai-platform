import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  readonly correlationId: string;
  readonly requestId: string;
  readonly serviceName?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly startTime: number;
  readonly signal: AbortSignal;
}

export function extractHeader(req: IncomingMessage, name: string): string | undefined {
  const val = req.headers[name.toLowerCase()];
  if (typeof val === 'string' && val.trim().length > 0) {
    return val.trim();
  }
  if (Array.isArray(val) && val[0]) {
    return val[0].trim();
  }
  return undefined;
}

export function extractRequestContext(req: IncomingMessage, res?: ServerResponse): RequestContext {
  const correlationId = extractHeader(req, 'x-correlation-id') ?? randomUUID();
  const requestId = extractHeader(req, 'x-request-id') ?? `req_${randomUUID().replace(/-/g, '')}`;
  const serviceName = extractHeader(req, 'x-service-name');
  const tenantId = extractHeader(req, 'x-tenant-id');
  const userId = extractHeader(req, 'x-user-id');
  const actorId = extractHeader(req, 'x-actor-id');

  const deadlineHeader = extractHeader(req, 'x-deadline-ms');
  const deadlineMs = deadlineHeader ? Number.parseInt(deadlineHeader, 10) : undefined;

  const controller = new AbortController();
  req.on('close', () => {
    if (!req.complete) {
      controller.abort();
    }
  });

  if (res) {
    res.setHeader('X-Correlation-ID', correlationId);
    res.setHeader('X-Request-ID', requestId);
  }

  return {
    correlationId,
    requestId,
    serviceName,
    tenantId,
    userId,
    actorId,
    deadlineMs: Number.isNaN(deadlineMs) ? undefined : deadlineMs,
    startTime: Date.now(),
    signal: controller.signal,
  };
}
