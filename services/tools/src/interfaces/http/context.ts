import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  readonly correlationId: string;
  readonly requestId: string;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly actorRoles?: readonly string[] | undefined;
  readonly deadlineAt?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly clientIp?: string | undefined;
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
  const tenantId = extractHeader(req, 'x-tenant-id');
  const userId = extractHeader(req, 'x-user-id');
  const actorId = extractHeader(req, 'x-actor-id');
  const idempotencyKey = extractHeader(req, 'x-idempotency-key');
  const deadlineAt = extractHeader(req, 'x-deadline-at');

  const deadlineHeader = extractHeader(req, 'x-deadline-ms');
  const deadlineMs = deadlineHeader ? Number.parseInt(deadlineHeader, 10) : undefined;

  const actorRolesHeader = extractHeader(req, 'x-actor-roles');
  let actorRoles: string[] | undefined;
  if (actorRolesHeader) {
    try {
      if (actorRolesHeader.startsWith('[')) {
        actorRoles = JSON.parse(actorRolesHeader) as string[];
      } else {
        actorRoles = actorRolesHeader.split(',').map((r) => r.trim());
      }
    } catch {
      actorRoles = actorRolesHeader.split(',').map((r) => r.trim());
    }
  }

  const clientIp =
    extractHeader(req, 'x-forwarded-for')?.split(',')[0]?.trim() ?? req.socket.remoteAddress;

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
    tenantId,
    userId,
    actorId,
    actorRoles: actorRoles ? Object.freeze(actorRoles) : undefined,
    deadlineAt,
    deadlineMs: Number.isNaN(deadlineMs) ? undefined : deadlineMs,
    idempotencyKey,
    clientIp,
    startTime: Date.now(),
    signal: controller.signal,
  };
}
