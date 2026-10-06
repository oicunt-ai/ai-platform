import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentId, AgentRunId } from '../../domain/types.js';
import type { DatabasePool } from '../../infrastructure/database/connection.js';
import type { AgentQueuePort } from '../../application/ports/agent-queue.port.js';
import type { JsonLogger } from '../../infrastructure/logging/logger.js';
import { isHealthCheckPath, validateInternalToken } from './auth.js';
import { extractRequestContext } from './context.js';
import { handleLiveness, handleReadiness } from './health.js';
import { sendErrorResponse } from './middleware.js';
import type { AgentsController, RunsController } from './controllers/index.js';

export interface RouterDependencies {
  readonly agentsController: AgentsController;
  readonly runsController: RunsController;
  readonly dbPool: DatabasePool | null;
  readonly queue?: AgentQueuePort | null | undefined;
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
        await handleReadiness(res, deps.dbPool, deps.queue);
        return;
      }
    }

    const context = extractRequestContext(req, res);

    try {
      validateInternalToken(req, deps.internalToken);

      // Route: GET /internal/v1/agents
      if (method === 'GET' && pathname === '/internal/v1/agents') {
        await deps.agentsController.handleList(req, res, context);
        return;
      }

      // Route: POST /internal/v1/agents
      if (method === 'POST' && pathname === '/internal/v1/agents') {
        await deps.agentsController.handleRegister(req, res, context);
        return;
      }

      // Route: POST /internal/v1/agents/runs
      if (method === 'POST' && pathname === '/internal/v1/agents/runs') {
        await deps.runsController.handleStart(req, res, context);
        return;
      }

      // Route: GET /internal/v1/agents/runs/:runId/steps
      const stepsMatch = pathname.match(/^\/internal\/v1\/agents\/runs\/([^/]+)\/steps$/);
      if (method === 'GET' && stepsMatch && stepsMatch[1]) {
        const runId = decodeURIComponent(stepsMatch[1]) as AgentRunId;
        await deps.runsController.handleGetSteps(req, res, context, runId);
        return;
      }

      // Route: POST /internal/v1/agents/runs/:runId/resume
      const resumeMatch = pathname.match(/^\/internal\/v1\/agents\/runs\/([^/]+)\/resume$/);
      if (method === 'POST' && resumeMatch && resumeMatch[1]) {
        const runId = decodeURIComponent(resumeMatch[1]) as AgentRunId;
        await deps.runsController.handleResume(req, res, context, runId);
        return;
      }

      // Route: POST /internal/v1/agents/runs/:runId/cancel
      const cancelMatch = pathname.match(/^\/internal\/v1\/agents\/runs\/([^/]+)\/cancel$/);
      if (method === 'POST' && cancelMatch && cancelMatch[1]) {
        const runId = decodeURIComponent(cancelMatch[1]) as AgentRunId;
        await deps.runsController.handleCancel(req, res, context, runId);
        return;
      }

      // Route: GET /internal/v1/agents/runs/:runId
      const runMatch = pathname.match(/^\/internal\/v1\/agents\/runs\/([^/]+)$/);
      if (method === 'GET' && runMatch && runMatch[1]) {
        const runId = decodeURIComponent(runMatch[1]) as AgentRunId;
        await deps.runsController.handleGet(req, res, context, runId);
        return;
      }

      // Route: GET /internal/v1/agents/:agentId
      const agentMatch = pathname.match(/^\/internal\/v1\/agents\/([^/]+)$/);
      if (method === 'GET' && agentMatch && agentMatch[1]) {
        const agentId = decodeURIComponent(agentMatch[1]) as AgentId;
        await deps.agentsController.handleGet(req, res, context, agentId);
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
      sendErrorResponse(res, err, context);
    }
  };
}
