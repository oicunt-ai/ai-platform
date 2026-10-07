import type { IncomingMessage } from 'node:http';
import type { RequestContext } from '../../interfaces/http/context.js';

export interface AuthenticatedActorContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly roles: readonly string[];
}

export interface PerimeterAuthPort {
  authenticate(req: IncomingMessage, context: RequestContext): Promise<AuthenticatedActorContext>;
}
