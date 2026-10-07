import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabasePool } from '../../infrastructure/database/connection.js';
import type { JsonLogger } from '../../infrastructure/logging/logger.js';
import { isHealthCheckPath, validateInternalToken } from './auth.js';
import { extractRequestContext } from './context.js';
import { handleLiveness, handleReadiness } from './health.js';
import { sendErrorResponse } from './middleware.js';
import type {
  ExecutionController,
  McpGatewayController,
  ServersController,
} from './controllers/index.js';
import { McpInvalidRequestError } from '../../domain/errors.js';

export interface RouterDependencies {
  readonly serversController: ServersController;
  readonly executionController: ExecutionController;
  readonly mcpGatewayController?: McpGatewayController | undefined;
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
      // Phase 2: Outbound MCP Server Gateway endpoint (Streamable HTTP)
      if (pathname === '/mcp' && method === 'POST') {
        if (deps.mcpGatewayController) {
          await deps.mcpGatewayController.handleMcpPost(req, res, context);
          return;
        }
      }

      validateInternalToken(req, deps.internalToken);

      // Route: POST /internal/v1/mcp/servers
      if (method === 'POST' && pathname === '/internal/v1/mcp/servers') {
        await deps.serversController.handleRegister(req, res, context);
        return;
      }

      // Route: GET /internal/v1/mcp/servers
      if (method === 'GET' && pathname === '/internal/v1/mcp/servers') {
        await deps.serversController.handleList(req, res, context);
        return;
      }

      // Route: POST /internal/v1/mcp/execute
      if (method === 'POST' && pathname === '/internal/v1/mcp/execute') {
        await deps.executionController.handleExecute(req, res, context);
        return;
      }

      // Server sub-routes: /internal/v1/mcp/servers/:serverId/...
      const serverPrefix = '/internal/v1/mcp/servers/';
      if (pathname.startsWith(serverPrefix)) {
        const remainder = pathname.slice(serverPrefix.length);
        const parts = remainder.split('/');
        const serverId = decodeURIComponent(parts[0] || '');

        if (!serverId) {
          throw new McpInvalidRequestError('Missing serverId parameter in path');
        }

        // GET /internal/v1/mcp/servers/:serverId
        if (parts.length === 1 && method === 'GET') {
          await deps.serversController.handleGet(req, res, context, serverId);
          return;
        }

        // POST /internal/v1/mcp/servers/:serverId/refresh
        if (parts.length === 2 && parts[1] === 'refresh' && method === 'POST') {
          await deps.serversController.handleRefresh(req, res, context, serverId);
          return;
        }

        // POST /internal/v1/mcp/servers/:serverId/disconnect
        if (parts.length === 2 && parts[1] === 'disconnect' && method === 'POST') {
          await deps.serversController.handleDisconnect(req, res, context, serverId);
          return;
        }
      }

      // 404 for unknown endpoints
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `Route '${method} ${pathname}' not found`,
          },
        }),
      );
    } catch (err: unknown) {
      deps.logger?.error('Error handling MCP HTTP request', {
        error: err instanceof Error ? err.message : String(err),
        pathname,
        method,
        correlationId: context.correlationId,
      });
      sendErrorResponse(res, err, context);
    }
  };
}
