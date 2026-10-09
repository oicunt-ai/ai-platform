import type { IncomingMessage } from 'node:http';
import type { RequestContext } from './context.js';
import {
  type CreateInternalServiceTokenParams,
  type InternalServiceTokenClaims,
  type TokenVerificationResult,
  type VerifyInternalServiceTokenOptions,
  createInternalServiceToken,
  verifyInternalServiceToken,
} from '../../infrastructure/security/internal-service-token.js';

export {
  createInternalServiceToken,
  verifyInternalServiceToken,
  type CreateInternalServiceTokenParams,
  type InternalServiceTokenClaims,
  type TokenVerificationResult,
  type VerifyInternalServiceTokenOptions,
};

export interface AuthenticateInternalRequestOptions {
  readonly secret?: string | undefined;
  readonly expectedAudience: string;
  readonly allowedServiceIdentities: readonly string[];
  readonly isProduction?: boolean | undefined;
  readonly clockSkewSeconds?: number | undefined;
}

export type AuthenticatedRequestResult =
  | {
      readonly authenticated: true;
      readonly serviceName: string;
      readonly claims?: InternalServiceTokenClaims | undefined;
    }
  | {
      readonly authenticated: false;
      readonly statusCode: 401 | 403;
      readonly errorCode: string;
      readonly message: string;
    };

export function extractInternalToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const internalTokenHeader = req.headers['x-internal-token'];
  if (typeof internalTokenHeader === 'string') {
    return internalTokenHeader.trim();
  }
  return undefined;
}

export function validateServiceIdentity(
  context: RequestContext,
  allowedServices: readonly string[],
): boolean {
  if (!context.serviceName) {
    return false;
  }
  return allowedServices.includes(context.serviceName);
}

/**
 * Authenticates an incoming internal HTTP request to the Model Gateway.
 * - Extracts and cryptographically verifies the short-lived signed internal service token.
 * - Validates expiration and audience ('model-gateway').
 * - Verifies caller identity in allowedServiceIdentities (e.g. 'inference').
 * - Prevents client spoofing of X-Service-Name.
 */
export function authenticateInternalRequest(
  req: IncomingMessage,
  options: AuthenticateInternalRequestOptions,
): AuthenticatedRequestResult {
  if (!options.secret) {
    if (options.isProduction) {
      return {
        authenticated: false,
        statusCode: 401,
        errorCode: 'AUTHENTICATION_ERROR',
        message: 'Internal service authentication token is required in production',
      };
    }
    const rawSvc = req.headers['x-service-name'];
    const serviceName = typeof rawSvc === 'string' ? rawSvc.trim() : undefined;
    if (
      !serviceName ||
      (options.allowedServiceIdentities.length > 0 &&
        !options.allowedServiceIdentities.includes(serviceName))
    ) {
      return {
        authenticated: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN_SERVICE_IDENTITY',
        message: `Service '${serviceName ?? 'unknown'}' is not authorized to invoke Model Gateway`,
      };
    }
    return {
      authenticated: true,
      serviceName,
    };
  }

  const token = extractInternalToken(req);
  if (!token) {
    return {
      authenticated: false,
      statusCode: 401,
      errorCode: 'AUTHENTICATION_ERROR',
      message: 'Invalid or missing internal service token',
    };
  }

  const result = verifyInternalServiceToken(token, {
    secret: options.secret,
    expectedAudience: options.expectedAudience,
    allowedServiceIdentities: options.allowedServiceIdentities,
    clockSkewSeconds: options.clockSkewSeconds,
  });

  if (!result.success) {
    return {
      authenticated: false,
      statusCode: result.statusCode,
      errorCode: result.errorCode === 'FORBIDDEN' ? 'FORBIDDEN_SERVICE_IDENTITY' : result.errorCode,
      message: result.message,
    };
  }

  const rawHeaderSvc = req.headers['x-service-name'];
  const headerSvc = typeof rawHeaderSvc === 'string' ? rawHeaderSvc.trim() : undefined;
  if (headerSvc && headerSvc !== result.serviceName) {
    return {
      authenticated: false,
      statusCode: 403,
      errorCode: 'FORBIDDEN_SERVICE_IDENTITY',
      message: `Spoofed X-Service-Name '${headerSvc}' does not match authenticated token identity '${result.serviceName}'`,
    };
  }

  for (const [headerName, claim] of [
    ['x-tenant-id', result.claims.tenantId],
    ['x-user-id', result.claims.userId],
    ['x-request-id', result.claims.requestId],
    ['x-correlation-id', result.claims.correlationId],
  ] as const) {
    if (claim !== req.headers[headerName]) {
      return {
        authenticated: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN_SERVICE_IDENTITY',
        message: 'Signed request context mismatch',
      };
    }
  }

  return {
    authenticated: true,
    serviceName: result.serviceName,
    claims: result.claims,
  };
}
