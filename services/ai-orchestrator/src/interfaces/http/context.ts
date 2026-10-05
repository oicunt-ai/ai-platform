import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { TurnExecutionContext } from '../../domain/types.js';

export interface RequestContext extends TurnExecutionContext {
  readonly serviceName?: string | undefined;
  readonly receivedAt: Date;
}

export function extractRequestContext(req: IncomingMessage): RequestContext {
  const getHeader = (name: string): string | undefined => {
    const val = req.headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0];
    return val?.trim() || undefined;
  };

  const requestId = getHeader('x-request-id') || randomUUID();
  const correlationId = getHeader('x-correlation-id') || randomUUID();
  const serviceName = getHeader('x-service-name');
  const userId = getHeader('x-user-id');
  const tenantId = getHeader('x-tenant-id');
  const actorId = getHeader('x-actor-id') || serviceName || 'system';
  const turnId = getHeader('x-turn-id') || randomUUID();
  const conversationId = getHeader('x-conversation-id');
  const cacheControl = getHeader('cache-control');
  const bypassCache = cacheControl?.toLowerCase().includes('no-cache') ?? false;

  return {
    requestId,
    correlationId,
    serviceName,
    userId,
    tenantId,
    actorId,
    turnId,
    conversationId,
    startTime: Date.now(),
    receivedAt: new Date(),
    bypassCache,
  };
}
