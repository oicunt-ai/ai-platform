import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateInternalRequest } from './auth.js';
import { extractRequestContext } from './context.js';
import { sendLivenessResponse, sendReadinessResponse } from './health.js';
import type { DispatchController } from './controllers/dispatch.controller.js';

export interface RouterDependencies {
  readonly dispatchController: DispatchController;
  readonly serviceName: string;
  readonly version: string;
  readonly isReady: () => boolean;
  readonly allowedServiceIdentities: readonly string[];
  readonly internalToken?: string | undefined;
  readonly environment?: string | undefined;
}

export function createHttpRouter(
  deps: RouterDependencies,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const context = extractRequestContext(req);
    const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // 1. Health Probes (unauthenticated)
    if (method === 'GET' && (pathname === '/healthz' || pathname === '/health/liveness')) {
      sendLivenessResponse(res, deps.serviceName, deps.version);
      return;
    }

    if (method === 'GET' && (pathname === '/readyz' || pathname === '/health/readiness')) {
      sendReadinessResponse(res, deps.isReady(), deps.serviceName, deps.version);
      return;
    }

    // 2. Protected Internal Routes - Service Identity & Token Verification
    if (pathname.startsWith('/internal/')) {
      const authResult = authenticateInternalRequest(req, {
        secret: deps.internalToken,
        expectedAudience: 'model-gateway',
        allowedServiceIdentities: deps.allowedServiceIdentities,
        isProduction: deps.environment === 'production',
      });

      if (!authResult.authenticated) {
        res.writeHead(authResult.statusCode, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Request-ID': context.requestId,
          'X-Correlation-ID': context.correlationId,
        });
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: authResult.errorCode,
              message: authResult.message,
            },
          }),
        );
        return;
      }

      (context as { serviceName?: string }).serviceName = authResult.serviceName;
    }

    // 3. Dispatch Route
    if (pathname === '/internal/v1/models/dispatch') {
      if (method === 'POST') {
        await deps.dispatchController.handleDispatch(req, res, context);
        return;
      }
      res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } }));
      return;
    }

    // 4. Not Found
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Cannot ${method} ${pathname}`,
        },
      }),
    );
  };
}
