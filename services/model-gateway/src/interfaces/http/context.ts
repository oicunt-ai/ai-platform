import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly serviceName?: string | undefined;
  readonly userId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly actorId?: string | undefined;
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
  // Never manufacture an actor identity: without an explicit x-actor-id or
  // an authenticated service name there is no actor to attribute. Callers
  // without any service identity fail authentication before dispatch;
  // downstream, an absent actorId is omitted from billing events (valid),
  // while a fabricated one would be rejected as synthetic.
  const actorId = getHeader('x-actor-id') || serviceName || undefined;

  return {
    requestId,
    correlationId,
    serviceName,
    userId,
    tenantId,
    actorId,
    receivedAt: new Date(),
  };
}
