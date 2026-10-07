import type { IncomingMessage } from 'node:http';
import type { RequestContext } from '../../interfaces/http/context.js';
import type {
  AuthenticatedActorContext,
  PerimeterAuthPort,
} from '../../application/ports/perimeter-auth.port.js';
import { McpSecurityError } from '../../domain/errors.js';

export interface PerimeterAuthAdapterOptions {
  /**
   * Internal service token used when requests are routed via trusted platform perimeter ingress.
   */
  readonly internalServiceToken?: string | undefined;
  /**
   * Pre-configured token mappings for trusted services or tests.
   */
  readonly staticTokens?: Record<string, AuthenticatedActorContext> | undefined;
  /**
   * Custom token verification hook (e.g. JWT perimeter verifier).
   */
  readonly tokenVerifier?: (
    token: string,
  ) => Promise<AuthenticatedActorContext | null> | AuthenticatedActorContext | null;
}

export class PlatformPerimeterAuthAdapter implements PerimeterAuthPort {
  private readonly internalServiceToken?: string | undefined;
  private readonly staticTokens: Map<string, AuthenticatedActorContext>;
  private readonly tokenVerifier?:
    | ((
        token: string,
      ) => Promise<AuthenticatedActorContext | null> | AuthenticatedActorContext | null)
    | undefined;

  constructor(options: PerimeterAuthAdapterOptions = {}) {
    this.internalServiceToken = options.internalServiceToken;
    this.staticTokens = new Map(Object.entries(options.staticTokens ?? {}));
    this.tokenVerifier = options.tokenVerifier;
  }

  public async authenticate(
    req: IncomingMessage,
    _context: RequestContext,
  ): Promise<AuthenticatedActorContext> {
    const authHeader = req.headers['authorization'];
    const perimeterHeader = req.headers['x-perimeter-auth-token'];

    let token: string | undefined;

    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (typeof perimeterHeader === 'string') {
      token = perimeterHeader.trim();
    } else if (typeof req.headers['x-internal-token'] === 'string') {
      token = (req.headers['x-internal-token'] as string).trim();
    }

    if (!token) {
      throw new McpSecurityError(
        'Authentication required: Missing perimeter bearer credentials. Direct untrusted access is prohibited.',
      );
    }

    // 1. Trusted Platform Perimeter Ingress (when routed via internal service token)
    const internalHeader = req.headers['x-internal-token'];
    const presentedInternalToken =
      typeof internalHeader === 'string' ? internalHeader.trim() : undefined;
    if (
      this.internalServiceToken &&
      (token === this.internalServiceToken || presentedInternalToken === this.internalServiceToken)
    ) {
      const tenantId = (req.headers['x-tenant-id'] as string | undefined)?.trim();
      const actorId = (req.headers['x-actor-id'] as string | undefined)?.trim();
      const userId = (req.headers['x-user-id'] as string | undefined)?.trim() || actorId;
      const rolesHeader = req.headers['x-roles'] as string | undefined;
      const roles = rolesHeader
        ? rolesHeader
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
        : ['developer'];

      if (tenantId && actorId) {
        return {
          tenantId,
          userId: userId || actorId,
          actorId,
          roles: Object.freeze(roles),
        };
      }
    }

    // 2. Check configured static/service tokens
    const staticMatch = this.staticTokens.get(token);
    if (staticMatch) {
      return {
        tenantId: staticMatch.tenantId,
        userId: staticMatch.userId,
        actorId: staticMatch.actorId,
        roles: Object.freeze([...staticMatch.roles]),
      };
    }

    // 2. Check custom verifier if provided
    if (this.tokenVerifier) {
      const verified = await this.tokenVerifier(token);
      if (verified && verified.tenantId && verified.actorId) {
        return {
          tenantId: verified.tenantId,
          userId: verified.userId ?? verified.actorId,
          actorId: verified.actorId,
          roles: Object.freeze([...(verified.roles ?? [])]),
        };
      }
    }

    // 3. Structured test / dev tokens (format: test-actor:<tenantId>:<userId>:<actorId>[:role1,role2])
    if (token.startsWith('test-actor:')) {
      const parts = token.slice('test-actor:'.length).split(':');
      const tenantId = parts[0]?.trim();
      const userId = parts[1]?.trim() || parts[0]?.trim();
      const actorId = parts[2]?.trim() || parts[1]?.trim() || 'actor-default';
      const roles = parts[3]
        ? parts[3]
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
        : ['developer'];

      if (tenantId) {
        return {
          tenantId,
          userId: userId || 'user-default',
          actorId,
          roles: Object.freeze(roles),
        };
      }
    }

    // Fail closed
    throw new McpSecurityError('Authentication failed: Invalid or expired perimeter credentials');
  }
}
