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
