import type { IncomingMessage, ServerResponse } from 'node:http';
import { isHealthCheckPath, validateInternalToken, validateServiceIdentity } from './auth.js';
import { extractRequestContext } from './context.js';
import type { ConversationController } from './controllers/conversation.controller.js';
import type { MessageController } from './controllers/message.controller.js';
import type { ContextController } from './controllers/context.controller.js';
import type { PurgeController } from './controllers/purge.controller.js';
import { handleLiveness, handleReadiness, type HealthCheckOptions } from './health.js';
import { sendErrorResponse } from './middleware.js';

export interface HttpRouterDependencies {
  readonly conversationController: ConversationController;
  readonly messageController: MessageController;
  readonly contextController: ContextController;
  readonly purgeController: PurgeController;
  readonly healthOptions: HealthCheckOptions;
  readonly internalToken?: string | undefined;
  readonly allowedServiceIdentities?: readonly string[] | undefined;
}

export function createHttpRouter(deps: HttpRouterDependencies) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const path = parsedUrl.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // 1. Health probes (unauthenticated)
    if (isHealthCheckPath(path) && method === 'GET') {
      if (path === '/healthz' || path === '/health/liveness') {
        handleLiveness(req, res);
        return;
      }
      if (path === '/readyz' || path === '/health/readiness') {
        await handleReadiness(req, res, deps.healthOptions);
        return;
      }
    }

    // 2. Extract context
    const context = extractRequestContext(req, res);

    // 3. Security checks on all /internal/v1/memory/* routes
    try {
      validateInternalToken(req, deps.internalToken);
      validateServiceIdentity(context, deps.allowedServiceIdentities);
    } catch (err) {
      sendErrorResponse(res, err, context);
      return;
    }

    // 4. Route matching
    try {
      // POST & GET /internal/v1/memory/conversations
      if (path === '/internal/v1/memory/conversations') {
        if (method === 'POST') {
          await deps.conversationController.handleCreate(req, res, context);
          return;
        }
        if (method === 'GET') {
          await deps.conversationController.handleList(req, res, context, parsedUrl.searchParams);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['GET', 'POST'] }));
        return;
      }

      // /internal/v1/memory/conversations/:id/context
      const contextMatch = path.match(/^\/internal\/v1\/memory\/conversations\/([^/]+)\/context$/);
      if (contextMatch) {
        const conversationId = decodeURIComponent(contextMatch[1]!);
        if (method === 'POST') {
          await deps.contextController.handleGetContext(req, res, context, conversationId);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['POST'] }));
        return;
      }

      // /internal/v1/memory/conversations/:id/messages
      const messagesMatch = path.match(
        /^\/internal\/v1\/memory\/conversations\/([^/]+)\/messages$/,
      );
      if (messagesMatch) {
        const conversationId = decodeURIComponent(messagesMatch[1]!);
        if (method === 'POST') {
          await deps.messageController.handleAppend(req, res, context, conversationId);
          return;
        }
        if (method === 'GET') {
          await deps.messageController.handleList(
            req,
            res,
            context,
            conversationId,
            parsedUrl.searchParams,
          );
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['GET', 'POST'] }));
        return;
      }

      // /internal/v1/memory/conversations/:id
      const convMatch = path.match(/^\/internal\/v1\/memory\/conversations\/([^/]+)$/);
      if (convMatch) {
        const conversationId = decodeURIComponent(convMatch[1]!);
        if (method === 'GET') {
          await deps.conversationController.handleGet(req, res, context, conversationId);
          return;
        }
        if (method === 'PATCH') {
          await deps.conversationController.handleUpdate(req, res, context, conversationId);
          return;
        }
        if (method === 'DELETE') {
          await deps.conversationController.handleDelete(
            req,
            res,
            context,
            conversationId,
            parsedUrl.searchParams,
          );
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: 'Method Not Allowed', allowed: ['GET', 'PATCH', 'DELETE'] }),
        );
        return;
      }

      // POST /internal/v1/memory/tenants/:tenantId/purge
      const purgeMatch = path.match(/^\/internal\/v1\/memory\/tenants\/([^/]+)\/purge$/);
      if (purgeMatch) {
        const tenantId = decodeURIComponent(purgeMatch[1]!);
        if (method === 'POST') {
          await deps.purgeController.handlePurge(req, res, context, tenantId);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['POST'] }));
        return;
      }

      // Route not recognized -> 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Not Found',
          message: `Route '${method} ${path}' not recognized`,
        }),
      );
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  };
}
