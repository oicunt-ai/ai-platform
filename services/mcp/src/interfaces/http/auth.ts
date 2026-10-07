import type { IncomingMessage } from 'node:http';
import { McpInvalidRequestError, McpSecurityError } from '../../domain/errors.js';
import type { RequestContext } from './context.js';
import { extractHeader } from './context.js';

export function isHealthCheckPath(pathname: string): boolean {
  return (
    pathname === '/healthz' ||
    pathname === '/readyz' ||
    pathname === '/health/liveness' ||
    pathname === '/health/readiness'
  );
}

export function validateInternalToken(req: IncomingMessage, internalToken?: string): void {
  if (!internalToken || internalToken.trim().length === 0) {
    return;
  }

  const authHeader = extractHeader(req, 'authorization');
  const tokenHeader = extractHeader(req, 'x-internal-token');

  let providedToken: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.slice(7).trim();
  } else if (tokenHeader) {
    providedToken = tokenHeader.trim();
  }

  if (!providedToken || providedToken !== internalToken) {
    throw new McpSecurityError('Missing or invalid service authorization token');
  }
}

export function validateTenantHeader(context: RequestContext): string {
  if (!context.tenantId || context.tenantId.trim().length === 0) {
    throw new McpInvalidRequestError('Missing mandatory X-Tenant-ID header');
  }
  return context.tenantId.trim();
}
