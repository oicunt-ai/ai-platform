import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendLivenessResponse, sendReadinessResponse } from './health.js';
import { createRequestContext, handleHttpError } from './middleware.js';

export interface HttpRouterOptions {
  readonly serviceName: string;
  readonly version: string;
  readonly isReady: () => boolean;
}

export function createHttpRouter(
  options: HttpRouterOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const context = createRequestContext(req, res);

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);
      const pathname = url.pathname;

      if (req.method === 'GET' && (pathname === '/healthz' || pathname === '/health/liveness')) {
        sendLivenessResponse(res, options.serviceName, options.version);
        return;
      }

      if (req.method === 'GET' && (pathname === '/readyz' || pathname === '/health/readiness')) {
        sendReadinessResponse(res, options.isReady(), options.serviceName, options.version);
        return;
      }

      // Default 404
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'ROUTE_NOT_FOUND',
            message: `Route '${req.method ?? 'GET'} ${pathname}' was not found`,
          },
          meta: {
            timestamp: new Date().toISOString(),
            correlationId: context.correlationId,
          },
        }),
      );
    } catch (error) {
      handleHttpError(res, error, context);
    }
  };
}
