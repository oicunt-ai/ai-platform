import type { IncomingMessage } from 'node:http';
import { verifyInternalServiceToken } from '../../infrastructure/security/internal-service-token.js';
import { AuthenticationError, ForbiddenError, InvalidRequestError } from '../../domain/index.js';
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

  const signed = providedToken
    ? verifyInternalServiceToken(providedToken, internalToken, 'memory')
    : null;
  const rawTestToken = process.env['NODE_ENV'] === 'test' && providedToken === internalToken;
  if (!providedToken || (!signed && !rawTestToken)) {
    throw new AuthenticationError('Missing or invalid service authorization token');
  }

  if (signed) {
    const pairs = [
      ['x-service-name', signed.sub],
      ['x-tenant-id', signed.tenantId],
      ['x-user-id', signed.userId],
      ['x-request-id', signed.requestId],
      ['x-correlation-id', signed.correlationId],
    ] as const;
    for (const [name, value] of pairs) {
      if (value !== req.headers[name]) {
        throw new AuthenticationError('Signed request context mismatch');
      }
    }
  }
}

export function validateServiceIdentity(
  context: RequestContext,
  allowedServiceIdentities?: readonly string[],
): void {
  if (!allowedServiceIdentities || allowedServiceIdentities.length === 0) {
    return;
  }

  const serviceName = context.serviceName;
  if (!serviceName) {
    throw new AuthenticationError('Missing X-Service-Name header');
  }

  if (!allowedServiceIdentities.includes(serviceName)) {
    throw new ForbiddenError(
      `Service identity '${serviceName}' is not authorized to invoke Memory Service`,
    );
  }
}

export function validateTenantHeader(context: RequestContext): string {
  if (!context.tenantId || context.tenantId.trim().length === 0) {
    throw new InvalidRequestError('Missing mandatory X-Tenant-ID header');
  }
  return context.tenantId.trim();
}

export function validateUserHeader(context: RequestContext): string {
  if (!context.userId || context.userId.trim().length === 0) {
    throw new InvalidRequestError('Missing mandatory X-User-ID header');
  }
  return context.userId.trim();
}
