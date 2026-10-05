import type { IncomingMessage } from 'node:http';
import type { RequestContext } from './context.js';

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
    return true; // No token configured in environment
  }

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim() === expectedToken;
  }

  const internalTokenHeader = req.headers['x-internal-token'];
  if (typeof internalTokenHeader === 'string') {
    return internalTokenHeader.trim() === expectedToken;
  }

  return false;
}
