import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticateInternalRequest } from './auth.js';
import { extractRequestContext } from './context.js';
import { sendLivenessResponse, sendReadinessResponse } from './health.js';
import type { ChatController } from './controllers/chat.controller.js';

export interface RouterDependencies {
  readonly chatController: ChatController;
  readonly serviceName: string;
  readonly version: string;
  readonly isReady: () => boolean;
  readonly getHealthChecks?: () =>
    Promise<Record<string, 'ok' | 'failed'>> | Record<string, 'ok' | 'failed'>;
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
      const checks = deps.getHealthChecks ? await deps.getHealthChecks() : undefined;
      const allChecksPass = checks
        ? Object.values(checks).every((status) => status === 'ok')
        : true;
      sendReadinessResponse(
        res,
        deps.isReady() && allChecksPass,
        deps.serviceName,
        deps.version,
        checks,
      );
      return;
    }

    // 2. Protected Internal Routes - Authentication & Service Whitelisting
    if (pathname.startsWith('/internal/')) {
      const authResult = authenticateInternalRequest(req, {
        secret: deps.internalToken,
        expectedAudience: 'ai-orchestrator',
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
            meta: {
              requestId: context.requestId,
              correlationId: context.correlationId,
              timestamp: new Date().toISOString(),
            },
          }),
        );
        return;
      }

      (context as { serviceName?: string }).serviceName = authResult.serviceName;
    }

    // 3. Chat Route
    if (pathname === '/internal/v1/orchestrator/chat') {
      if (method === 'POST') {
        await deps.chatController.handleChat(req, res, context);
        return;
      }
      res.writeHead(405, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-ID': context.requestId,
        'X-Correlation-ID': context.correlationId,
      });
      res.end(
        JSON.stringify({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: `Method ${method} not allowed` },
        }),
      );
      return;
    }

    // 4. Not Found
    res.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-ID': context.requestId,
      'X-Correlation-ID': context.correlationId,
    });
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Cannot ${method} ${pathname}`,
        },
        meta: {
          requestId: context.requestId,
          correlationId: context.correlationId,
          timestamp: new Date().toISOString(),
        },
      }),
    );
  };
}
