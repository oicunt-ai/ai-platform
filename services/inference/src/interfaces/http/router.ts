import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthenticationError, ForbiddenError } from '../../domain/errors.js';
import { authenticateInternalRequest } from './auth.js';
import { extractRequestContext } from './context.js';
import type { InferenceController } from './controllers/inference.controller.js';
import { handleLiveness, handleReadiness, type HealthCheckOptions } from './health.js';
import { sendErrorResponse } from './middleware.js';

export interface HttpRouterDependencies {
  readonly inferenceController: InferenceController;
  readonly healthOptions: HealthCheckOptions;
  readonly internalToken?: string | undefined;
  readonly allowedServiceIdentities?: readonly string[] | undefined;
  readonly environment?: string | undefined;
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

      // Security Check: Internal token & service identity verification
      const authResult = authenticateInternalRequest(req, {
        secret: deps.internalToken,
        expectedAudience: 'inference',
        allowedServiceIdentities: deps.allowedServiceIdentities ?? [
          'platform-api-gateway',
          'billy-api',
          'ai-orchestrator',
          'ai-platform-admin',
          'agent-runner',
        ],
        isProduction: deps.environment === 'production',
      });

      if (!authResult.authenticated) {
        const error =
          authResult.statusCode === 401
            ? new AuthenticationError(authResult.message, context.correlationId)
            : new ForbiddenError(authResult.message, context.correlationId);

        sendErrorResponse(res, error, context);
        return;
      }

      (context as { serviceName?: string }).serviceName = authResult.serviceName;

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
