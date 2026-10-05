import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthenticationError, ForbiddenError } from '../../domain/errors.js';
import { validateInternalToken, validateServiceIdentity } from './auth.js';
import { extractRequestContext } from './context.js';
import type { InferenceController } from './controllers/inference.controller.js';
import { handleLiveness, handleReadiness, type HealthCheckOptions } from './health.js';
import { sendErrorResponse } from './middleware.js';

export interface HttpRouterDependencies {
  readonly inferenceController: InferenceController;
  readonly healthOptions: HealthCheckOptions;
  readonly internalToken?: string | undefined;
  readonly allowedServiceIdentities?: readonly string[] | undefined;
}

export function createHttpRouter(deps: HttpRouterDependencies) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const path = parsedUrl.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // 1. Health Probes
    if (path === '/healthz' && method === 'GET') {
      handleLiveness(req, res);
      return;
    }

    if (path === '/readyz' && method === 'GET') {
      await handleReadiness(req, res, deps.healthOptions);
      return;
    }

    // 2. Extract Context
    const context = extractRequestContext(req);

    // 3. Inference Execution Endpoint
    if (path === '/internal/v1/inference/execute') {
      if (method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['POST'] }));
        return;
      }

      // Security Check: Internal token verification
      if (!validateInternalToken(req, deps.internalToken)) {
        sendErrorResponse(
          res,
          new AuthenticationError(
            'Invalid or missing internal service token',
            context.correlationId,
          ),
          context,
        );
        return;
      }

      // Security Check: Whitelisted service verification
      if (
        deps.allowedServiceIdentities &&
        deps.allowedServiceIdentities.length > 0 &&
        !validateServiceIdentity(context, deps.allowedServiceIdentities)
      ) {
        sendErrorResponse(
          res,
          new ForbiddenError(
            `Service identity '${context.serviceName ?? 'unknown'}' is not authorized to invoke Inference Service`,
            context.correlationId,
          ),
          context,
        );
        return;
      }

      await deps.inferenceController.handleExecute(req, res, context);
      return;
    }

    // 4. Fallback 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Not Found',
        message: `Route '${method} ${path}' not recognized`,
      }),
    );
  };
}
