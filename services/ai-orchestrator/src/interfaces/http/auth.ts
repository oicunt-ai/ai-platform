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

export function validateInternalToken(req: IncomingMessage, expectedToken?: string): boolean {
  if (!expectedToken) {
    return true;
  }
  const token = extractInternalToken(req);
  return token === expectedToken;
}

/**
 * Authenticates an incoming internal HTTP request.
 * - Extracts and cryptographically verifies the short-lived signed internal service token.
 * - Validates expiration and intended audience ('ai-orchestrator').
 * - Verifies that the calling service identity is permitted.
 * - Prevents client spoofing of X-Service-Name.
 */
export function authenticateInternalRequest(
  req: IncomingMessage,
  options: AuthenticateInternalRequestOptions,
): AuthenticatedRequestResult {
  // If no secret configured:
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
      serviceName &&
      options.allowedServiceIdentities.length > 0 &&
      !options.allowedServiceIdentities.includes(serviceName)
    ) {
      return {
        authenticated: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: `Service '${serviceName}' is not authorized to invoke AI Orchestrator`,
      };
    }
    return {
      authenticated: true,
      serviceName: serviceName ?? 'unknown',
    };
  }

  // 1. Extract token
  const token = extractInternalToken(req);
  if (!token) {
    return {
      authenticated: false,
      statusCode: 401,
      errorCode: 'AUTHENTICATION_ERROR',
      message: 'Invalid or missing internal service token',
    };
  }

  // 2. Cryptographically verify token
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
      errorCode: result.errorCode,
      message: result.message,
    };
  }

  const expectedContext: Array<[string, unknown]> = [
    ['x-tenant-id', result.claims.tenantId],
    ['x-user-id', result.claims.userId],
    ['x-request-id', result.claims.requestId],
    ['x-correlation-id', result.claims.correlationId],
  ];
  for (const [headerName, claimValue] of expectedContext) {
    const headerValue = req.headers[headerName];
    if (claimValue !== headerValue) {
      return {
        authenticated: false,
        statusCode: 403,
        errorCode: 'FORBIDDEN',
        message: `Signed request context does not match ${headerName}`,
      };
    }
  }

  // 3. Prevent X-Service-Name header spoofing:
  // If caller supplied X-Service-Name header, it MUST match the authenticated token subject.
  const rawHeaderSvc = req.headers['x-service-name'];
  const headerSvc = typeof rawHeaderSvc === 'string' ? rawHeaderSvc.trim() : undefined;
  if (headerSvc && headerSvc !== result.serviceName) {
    return {
      authenticated: false,
      statusCode: 403,
      errorCode: 'FORBIDDEN',
      message: `Spoofed X-Service-Name '${headerSvc}' does not match authenticated token identity '${result.serviceName}'`,
    };
  }

  return {
    authenticated: true,
    serviceName: result.serviceName,
    claims: result.claims,
  };
}
