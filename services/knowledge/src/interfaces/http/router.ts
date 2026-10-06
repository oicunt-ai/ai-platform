import type { IncomingMessage, ServerResponse } from 'node:http';
import { isHealthCheckPath, validateInternalToken, validateServiceIdentity } from './auth.js';
import { extractRequestContext } from './context.js';
import type { CollectionController } from './controllers/collection.controller.js';
import type { DocumentController } from './controllers/document.controller.js';
import type { RetrievalController } from './controllers/retrieval.controller.js';
import type { AdminController } from './controllers/admin.controller.js';
import { handleLiveness, handleReadiness, type HealthCheckOptions } from './health.js';
import { sendErrorResponse } from './middleware.js';

export interface HttpRouterDependencies {
  readonly collectionController: CollectionController;
  readonly documentController: DocumentController;
  readonly retrievalController: RetrievalController;
  readonly adminController: AdminController;
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

    // 3. Security checks on all /internal/v1/knowledge/* routes
    try {
      validateInternalToken(req, deps.internalToken);
      validateServiceIdentity(context, deps.allowedServiceIdentities);
    } catch (err) {
      sendErrorResponse(res, err, context);
      return;
    }

    // 4. Route matching
    try {
      // POST & GET /internal/v1/knowledge/collections
      if (path === '/internal/v1/knowledge/collections') {
        if (method === 'POST') {
          await deps.collectionController.handleCreate(req, res, context);
          return;
        }
        if (method === 'GET') {
          await deps.collectionController.handleList(req, res, context);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['GET', 'POST'] }));
        return;
      }

      // /internal/v1/knowledge/collections/:collectionId/documents
      const colDocsMatch = path.match(
        /^\/internal\/v1\/knowledge\/collections\/([^/]+)\/documents$/,
      );
      if (colDocsMatch) {
        const collectionId = decodeURIComponent(colDocsMatch[1]!);
        if (method === 'POST') {
          await deps.documentController.handleRegister(req, res, context, collectionId);
          return;
        }
        if (method === 'GET') {
          await deps.documentController.handleList(
            req,
            res,
            context,
            collectionId,
            parsedUrl.searchParams,
          );
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['GET', 'POST'] }));
        return;
      }

      // /internal/v1/knowledge/collections/:collectionId
      const colMatch = path.match(/^\/internal\/v1\/knowledge\/collections\/([^/]+)$/);
      if (colMatch) {
        const collectionId = decodeURIComponent(colMatch[1]!);
        if (method === 'GET') {
          await deps.collectionController.handleGet(req, res, context, collectionId);
          return;
        }
        if (method === 'DELETE') {
          await deps.collectionController.handleDelete(req, res, context, collectionId);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['GET', 'DELETE'] }));
        return;
      }

      // POST /internal/v1/knowledge/documents/:documentId/retry
      const retryMatch = path.match(/^\/internal\/v1\/knowledge\/documents\/([^/]+)\/retry$/);
      if (retryMatch) {
        const documentId = decodeURIComponent(retryMatch[1]!);
        if (method === 'POST') {
          await deps.documentController.handleRetry(req, res, context, documentId);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['POST'] }));
        return;
      }

      // /internal/v1/knowledge/documents/:documentId
      const docMatch = path.match(/^\/internal\/v1\/knowledge\/documents\/([^/]+)$/);
      if (docMatch) {
        const documentId = decodeURIComponent(docMatch[1]!);
        if (method === 'GET') {
          await deps.documentController.handleGet(req, res, context, documentId);
          return;
        }
        if (method === 'DELETE') {
          await deps.documentController.handleDelete(req, res, context, documentId);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['GET', 'DELETE'] }));
        return;
      }

      // POST /internal/v1/knowledge/retrieve
      if (path === '/internal/v1/knowledge/retrieve') {
        if (method === 'POST') {
          await deps.retrievalController.handleRetrieve(req, res, context);
          return;
        }
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed', allowed: ['POST'] }));
        return;
      }

      // POST /internal/v1/knowledge/admin/tenants/:tenantId/purge
      const purgeMatch = path.match(/^\/internal\/v1\/knowledge\/admin\/tenants\/([^/]+)\/purge$/);
      if (purgeMatch) {
        const tenantId = decodeURIComponent(purgeMatch[1]!);
        if (method === 'POST') {
          await deps.adminController.handlePurgeTenant(req, res, context, tenantId);
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
