import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const INTERNAL_TOKEN_CONTRACT_VERSION = '1.0.0' as const;

export interface InternalServiceTokenClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface CreateInternalServiceTokenParams {
  readonly issuer?: string | undefined;
  readonly serviceName?: string | undefined;
  readonly subject?: string | undefined;
  readonly audience: string;
  readonly secret: string;
  readonly expiresInSeconds?: number | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly correlationId?: string | undefined;
}

export interface VerifyInternalServiceTokenOptions {
  readonly secret: string;
  readonly expectedAudience?: string | undefined;
  readonly allowedServiceIdentities?: readonly string[] | undefined;
  readonly clockSkewSeconds?: number | undefined;
}

export type TokenVerificationResult =
  | {
      readonly success: true;
      readonly claims: InternalServiceTokenClaims;
      readonly serviceName: string;
    }
  | {
      readonly success: false;
      readonly statusCode: 401 | 403;
      readonly errorCode: string;
      readonly message: string;
    };

const failure = (statusCode: 401 | 403, message: string): TokenVerificationResult => ({
  success: false,
  statusCode,
  errorCode: statusCode === 401 ? 'AUTHENTICATION_ERROR' : 'FORBIDDEN',
  message,
});

export function createInternalServiceToken(params: CreateInternalServiceTokenParams): string {
  const now = Math.floor(Date.now() / 1000);
  const identity = params.serviceName ?? params.issuer ?? 'unknown';
  const claims: InternalServiceTokenClaims = {
    iss: params.issuer ?? identity,
    sub: params.subject ?? params.serviceName ?? identity,
    aud: params.audience,
    iat: now,
    exp: now + (params.expiresInSeconds ?? 300),
    jti: randomUUID(),
    tenantId: params.tenantId,
    userId: params.userId,
    requestId: params.requestId,
    correlationId: params.correlationId,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', params.secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyInternalServiceToken(
  token: string,
  options: VerifyInternalServiceTokenOptions,
): TokenVerificationResult {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return failure(401, 'Invalid internal service token format');
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    return failure(401, 'Invalid internal service token format');
  }
  try {
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as { alg?: string };
    if (header.alg !== 'HS256') return failure(401, 'Internal service tokens must use HS256');
    const expected = createHmac('sha256', options.secret)
      .update(`${headerPart}.${payloadPart}`)
      .digest('base64url');
    const actualBuffer = Buffer.from(signaturePart);
    const expectedBuffer = Buffer.from(expected);
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    )
      return failure(401, 'Invalid internal service token signature');

    const claims = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString(),
    ) as InternalServiceTokenClaims;
    const now = Math.floor(Date.now() / 1000);
    const skew = options.clockSkewSeconds ?? 5;
    if (!claims.iss || !claims.sub || !claims.jti || typeof claims.iat !== 'number') {
      return failure(401, 'Internal service token is missing required claims');
    }
    if (typeof claims.exp !== 'number' || claims.exp < now - skew) {
      return failure(401, 'Expired internal service token');
    }
    if (claims.iat > now + skew) return failure(401, 'Internal service token is not yet valid');
    if (options.expectedAudience && claims.aud !== options.expectedAudience) {
      return failure(403, 'Invalid internal service token audience');
    }
    if (
      options.allowedServiceIdentities?.length &&
      !options.allowedServiceIdentities.includes(claims.sub)
    )
      return failure(403, 'Calling service identity is not authorized');
    return { success: true, claims, serviceName: claims.sub };
  } catch {
    return failure(401, 'Malformed internal service token');
  }
}

export function assertSignedContextMatchesHeaders(
  claims: InternalServiceTokenClaims,
  headers: Readonly<Record<string, string | undefined>>,
): boolean {
  const pairs = [
    [claims.tenantId, headers['tenantId']],
    [claims.userId, headers['userId']],
    [claims.requestId, headers['requestId']],
    [claims.correlationId, headers['correlationId']],
  ] as const;
  return pairs.every(([claim, header]) => claim === header);
}
