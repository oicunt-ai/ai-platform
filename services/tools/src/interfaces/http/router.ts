import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ToolId } from '../../domain/index.js';
import type { DatabasePool } from '../../infrastructure/database/connection.js';
import type { JsonLogger } from '../../infrastructure/logging/logger.js';
import { isHealthCheckPath, validateInternalToken } from './auth.js';
import { extractRequestContext } from './context.js';
import { handleLiveness, handleReadiness } from './health.js';
import { sendErrorResponse } from './middleware.js';
import type { ExecutionController, ToolsController } from './controllers/index.js';

export interface RouterDependencies {
  readonly toolsController: ToolsController;
  readonly executionController: ExecutionController;
  readonly dbPool: DatabasePool | null;
  readonly internalToken?: string | undefined;
  readonly logger?: JsonLogger | undefined;
}

export function createHttpRouter(deps: RouterDependencies) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase();

    // Health endpoints bypass auth
    if (isHealthCheckPath(pathname)) {
      if (pathname === '/healthz' || pathname === '/health/liveness') {
        await handleLiveness(res);
        return;
      }
      if (pathname === '/readyz' || pathname === '/health/readiness') {
        await handleReadiness(res, deps.dbPool);
        return;
      }
    }

    const context = extractRequestContext(req, res);

    try {
      validateInternalToken(req, deps.internalToken);

      // Route: GET /internal/v1/tools
      if (method === 'GET' && pathname === '/internal/v1/tools') {
        await deps.toolsController.handleList(req, res, context);
        return;
      }

      // Route: POST /internal/v1/tools/register
      if (method === 'POST' && pathname === '/internal/v1/tools/register') {
        await deps.toolsController.handleRegister(req, res, context);
        return;
      }

      // Route: POST /internal/v1/tools/execute
      if (method === 'POST' && pathname === '/internal/v1/tools/execute') {
        await deps.executionController.handleExecuteSync(req, res, context);
        return;
      }

      // Route: POST /internal/v1/tools/execute-async
      if (method === 'POST' && pathname === '/internal/v1/tools/execute-async') {
        await deps.executionController.handleExecuteAsync(req, res, context);
        return;
      }

      // Route: POST /internal/v1/tools/executions/:executionId/cancel
      const cancelMatch = pathname.match(/^\/internal\/v1\/tools\/executions\/([^/]+)\/cancel$/);
      if (method === 'POST' && cancelMatch && cancelMatch[1]) {
        const executionId = decodeURIComponent(cancelMatch[1]);
        await deps.executionController.handleCancel(req, res, context, executionId);
        return;
      }

      // Route: GET /internal/v1/tools/executions/:executionId
      const statusMatch = pathname.match(/^\/internal\/v1\/tools\/executions\/([^/]+)$/);
      if (method === 'GET' && statusMatch && statusMatch[1]) {
        const executionId = decodeURIComponent(statusMatch[1]);
        await deps.executionController.handleGetStatus(req, res, context, executionId);
        return;
      }

      // Route: GET /internal/v1/tools/:toolId
      const toolMatch = pathname.match(/^\/internal\/v1\/tools\/([^/]+)$/);
      if (method === 'GET' && toolMatch && toolMatch[1]) {
        const toolId = decodeURIComponent(toolMatch[1]) as ToolId;
        await deps.toolsController.handleGet(req, res, context, toolId);
        return;
      }

      // 404 Route Not Found
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Route '${method} ${pathname}' not found`,
            retryable: false,
          },
          meta: {
            requestId: context.requestId,
            correlationId: context.correlationId,
            timestamp: new Date().toISOString(),
          },
        }),
      );
    } catch (err: unknown) {
      if (deps.logger) {
        deps.logger.error('Unhandled request error in Tools HTTP router', {
          correlationId: context.correlationId,
          requestId: context.requestId,
          tenantId: context.tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      sendErrorResponse(res, err, context);
    }
  };
}
