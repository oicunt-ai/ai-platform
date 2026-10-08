import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ModelRegistryConfig } from '../../config.js';
import { ModelValidationError } from '../../domain/index.js';
import type { RequestContext } from './context.js';
import { extractHeader } from './context.js';

export class UnauthorizedError extends Error {
  public readonly code = 'UNAUTHORIZED';
  public readonly statusCode = 401;

  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;

  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Validates the internal service trust boundary for all control-plane and resolution endpoints.
 * - Enforces internal authentication token (when configured)
 * - Validates authoritative service identity (X-Service-Name against allowed identities)
 * - Enforces RBAC: only 'ai-platform-admin' can perform administrative mutations
 * - Enforces mandatory audit headers (X-Actor-ID and X-Change-Reason for mutations)
 */
export function authenticateAndAuthorizeRequest(
  req: IncomingMessage,
  method: string,
  pathname: string,
  config: ModelRegistryConfig,
  context: RequestContext,
): void {
  // 1. Health probes are unauthenticated
  if (
    pathname === '/healthz' ||
    pathname === '/readyz' ||
    pathname === '/health/liveness' ||
    pathname === '/health/readiness'
  ) {
    return;
  }

  // 2. Validate internal authentication token if configured
  if (config.internalAuthToken && config.internalAuthToken.trim().length > 0) {
    const authHeader = extractHeader(req, 'authorization');
    const internalTokenHeader = extractHeader(req, 'x-internal-token');

    let providedToken: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice(7).trim();
    } else if (internalTokenHeader) {
      providedToken = internalTokenHeader.trim();
    }

    const isExactMatch = providedToken === config.internalAuthToken;
    let isValidSignedToken = false;
    if (!isExactMatch && providedToken && providedToken.split('.').length === 3) {
      try {
        const parts = providedToken.split('.');
        const [headerB64, payloadB64, signatureB64] = parts;
        if (headerB64 && payloadB64 && signatureB64) {
          const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
          if (header.alg === 'HS256') {
            const expSig = createHmac('sha256', config.internalAuthToken)
              .update(`${headerB64}.${payloadB64}`)
              .digest('base64url');
            const sigBuf = Buffer.from(signatureB64, 'utf8');
            const expBuf = Buffer.from(expSig, 'utf8');
            if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
              const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
              const now = Math.floor(Date.now() / 1000);
              if (typeof payload.exp === 'number' && payload.exp > now - 5) {
                isValidSignedToken = true;
              }
            }
          }
        }
      } catch {
        // Not a valid JWT
      }
    }

    if (!providedToken || (!isExactMatch && !isValidSignedToken)) {
      throw new UnauthorizedError('Missing or invalid internal authorization token');
    }
  }

  // 3. Validate service identity
  const serviceName = context.serviceName;
  if (!serviceName) {
    throw new UnauthorizedError('Missing X-Service-Name header');
  }

  if (!config.allowedServiceIdentities.includes(serviceName)) {
    throw new ForbiddenError(`Caller service identity '${serviceName}' is not permitted`);
  }

  // 4. Validate administrative mutations (POST, PUT, DELETE under /internal/v1/models)
  const isMutation = method === 'POST' || method === 'PUT' || method === 'DELETE';
  if (isMutation && pathname.startsWith('/internal/v1/models')) {
    if (serviceName !== 'ai-platform-admin') {
      throw new ForbiddenError(
        `Service '${serviceName}' is not authorized for administrative catalog mutations`,
      );
    }

    if (!context.actorId || context.actorId.trim().length === 0) {
      throw new ModelValidationError(
        'X-Actor-ID header is required for administrative mutations',
        'X-Actor-ID',
      );
    }

    if (pathname.endsWith('/status')) {
      if (!context.changeReason || context.changeReason.trim().length === 0) {
        throw new ModelValidationError(
          'X-Change-Reason header is required for status mutations',
          'X-Change-Reason',
        );
      }
    }
  }
}
