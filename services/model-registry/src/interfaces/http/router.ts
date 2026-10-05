import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModelRegistryConfig } from '../../config.js';
import { authenticateAndAuthorizeRequest } from './auth.js';
import { sendLivenessResponse, sendReadinessResponse } from './health.js';
import { createRequestContext } from './context.js';
import { handleHttpError } from './middleware.js';
import type { ResolutionController } from './controllers/resolution.controller.js';
import type { CatalogController } from './controllers/catalog.controller.js';

export interface HttpRouterOptions {
  readonly serviceName: string;
  readonly version: string;
  readonly isReady: () => boolean;
  readonly checkDbReady?: (() => Promise<boolean>) | undefined;
  readonly resolutionController: ResolutionController;
  readonly catalogController: CatalogController;
  readonly config: ModelRegistryConfig;
}

export function createHttpRouter(
  options: HttpRouterOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const context = createRequestContext(req, res);

    try {
      const host = req.headers['host'] ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      // 1. Health Probes
      if (method === 'GET' && (pathname === '/healthz' || pathname === '/health/liveness')) {
        sendLivenessResponse(res, options.serviceName, options.version);
        return;
      }

      if (method === 'GET' && (pathname === '/readyz' || pathname === '/health/readiness')) {
        const dbReady = options.checkDbReady ? await options.checkDbReady() : true;
        const overallReady = options.isReady() && dbReady;
        sendReadinessResponse(res, overallReady, options.serviceName, options.version, {
          database: dbReady ? 'ok' : 'failed',
        });
        return;
      }

      // 2. Validate internal authentication & authorization for all non-probe endpoints
      authenticateAndAuthorizeRequest(req, method, pathname, options.config, context);

      // 2. Resolution Endpoint: GET /internal/v1/models/resolve/:canonicalModelId
      const resolveMatch = pathname.match(/^\/internal\/v1\/models\/resolve\/([^/]+)$/);
      if (method === 'GET' && resolveMatch && resolveMatch[1]) {
        const canonicalModelId = decodeURIComponent(resolveMatch[1]);
        await options.resolutionController.handleResolve(res, canonicalModelId, url, context);
        return;
      }

      // 3. Catalog Model List & Create: /internal/v1/models
      if (pathname === '/internal/v1/models') {
        if (method === 'GET') {
          await options.catalogController.handleList(res, context);
          return;
        }
        if (method === 'POST') {
          await options.catalogController.handleCreateModel(req, res, context);
          return;
        }
      }

      // 4. Sub-resource routing under /internal/v1/models/:canonicalModelId/...
      const versionStatusMatch = pathname.match(
        /^\/internal\/v1\/models\/([^/]+)\/versions\/([^/]+)\/status$/,
      );
      if (
        method === 'PUT' &&
        versionStatusMatch &&
        versionStatusMatch[1] &&
        versionStatusMatch[2]
      ) {
        const modelId = decodeURIComponent(versionStatusMatch[1]);
        const version = decodeURIComponent(versionStatusMatch[2]);
        await options.catalogController.handleUpdateVersionStatus(
          req,
          res,
          modelId,
          version,
          context,
        );
        return;
      }

      const versionsMatch = pathname.match(/^\/internal\/v1\/models\/([^/]+)\/versions$/);
      if (method === 'POST' && versionsMatch && versionsMatch[1]) {
        const modelId = decodeURIComponent(versionsMatch[1]);
        await options.catalogController.handleCreateVersion(req, res, modelId, context);
        return;
      }

      const targetStatusMatch = pathname.match(
        /^\/internal\/v1\/models\/([^/]+)\/targets\/([^/]+)\/status$/,
      );
      if (method === 'PUT' && targetStatusMatch && targetStatusMatch[1] && targetStatusMatch[2]) {
        const modelId = decodeURIComponent(targetStatusMatch[1]);
        const targetId = decodeURIComponent(targetStatusMatch[2]);
        await options.catalogController.handleUpdateTargetStatus(
          req,
          res,
          modelId,
          targetId,
          context,
        );
        return;
      }

      const targetsMatch = pathname.match(/^\/internal\/v1\/models\/([^/]+)\/targets$/);
      if (method === 'POST' && targetsMatch && targetsMatch[1]) {
        const modelId = decodeURIComponent(targetsMatch[1]);
        await options.catalogController.handleCreateTarget(req, res, modelId, context);
        return;
      }

      const routingPolicyMatch = pathname.match(
        /^\/internal\/v1\/models\/([^/]+)\/routing-policy$/,
      );
      if (method === 'PUT' && routingPolicyMatch && routingPolicyMatch[1]) {
        const modelId = decodeURIComponent(routingPolicyMatch[1]);
        await options.catalogController.handleUpdateRoutingPolicy(req, res, modelId, context);
        return;
      }

      const aliasesMatch = pathname.match(/^\/internal\/v1\/models\/([^/]+)\/aliases$/);
      if (method === 'PUT' && aliasesMatch && aliasesMatch[1]) {
        const modelId = decodeURIComponent(aliasesMatch[1]);
        await options.catalogController.handleSetAlias(req, res, modelId, context);
        return;
      }

      // 5. Single Model Detail: GET /internal/v1/models/:canonicalModelId
      const singleModelMatch = pathname.match(/^\/internal\/v1\/models\/([^/]+)$/);
      if (method === 'GET' && singleModelMatch && singleModelMatch[1]) {
        const modelId = decodeURIComponent(singleModelMatch[1]);
        await options.catalogController.handleGet(res, modelId, context);
        return;
      }

      // 6. Route Not Found (404)
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'ROUTE_NOT_FOUND',
            message: `Route '${method} ${pathname}' was not found`,
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
