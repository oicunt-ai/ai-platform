import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentRunId } from '../../../domain/types.js';
import type {
  CancelRunUseCase,
  GetRunUseCase,
  GetStepsUseCase,
  ResumeRunUseCase,
  StartRunUseCase,
} from '../../../application/use-cases/index.js';
import type { CancelRunDto, ResumeRunDto, StartRunDto } from '../../../application/dtos/index.js';
import type { RequestContext } from '../context.js';
import { validateActorHeader, validateTenantHeader, validateUserHeader } from '../auth.js';
import { parseJsonBody, sendJsonResponse, sendSseEvent, setupSseResponse } from '../middleware.js';

export class RunsController {
  constructor(
    private readonly startRunUseCase: StartRunUseCase,
    private readonly getRunUseCase: GetRunUseCase,
    private readonly getStepsUseCase: GetStepsUseCase,
    private readonly resumeRunUseCase: ResumeRunUseCase,
    private readonly cancelRunUseCase: CancelRunUseCase,
  ) {}

  public async handleStart(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const userId = validateUserHeader(context);
    const actorId = validateActorHeader(context);

    const body = await parseJsonBody<StartRunDto>(req);
    const isStream = Boolean(body.stream);

    if (isStream) {
      setupSseResponse(res, context);

      try {
        await this.startRunUseCase.execute(
          body,
          {
            tenantId,
            userId,
            actorId,
            correlationId: context.correlationId,
          },
          {
            signal: context.signal,
            onEvent: (event) => {
              sendSseEvent(res, event.event, event.data);
            },
          },
        );
      } catch (err: unknown) {
        sendSseEvent(res, 'run_failed', {
          error: {
            code: (err as any).code ?? 'INTERNAL_AGENT_ERROR',
            message: (err as Error).message,
          },
        });
      } finally {
        res.end();
      }
      return;
    }

    const result = await this.startRunUseCase.execute(
      body,
      {
        tenantId,
        userId,
        actorId,
        correlationId: context.correlationId,
      },
      {
        signal: context.signal,
      },
    );

    const statusCode = body.mode === 'async' ? 202 : 201;
    sendJsonResponse(res, statusCode, result, context);
  }

  public async handleGet(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    runId: AgentRunId,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const detail = await this.getRunUseCase.execute(runId, { tenantId });
    sendJsonResponse(res, 200, detail, context);
  }

  public async handleGetSteps(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    runId: AgentRunId,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const steps = await this.getStepsUseCase.execute(runId, { tenantId });
    sendJsonResponse(res, 200, steps, context);
  }

  public async handleResume(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    runId: AgentRunId,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const actorId = validateActorHeader(context);

    const body = await parseJsonBody<ResumeRunDto & { stream?: boolean }>(req);
    const isStream = Boolean(body.stream);

    if (isStream) {
      setupSseResponse(res, context);

      try {
        await this.resumeRunUseCase.execute(
          runId,
          body,
          { tenantId, actorId },
          {
            signal: context.signal,
            onEvent: (event) => {
              sendSseEvent(res, event.event, event.data);
            },
          },
        );
      } catch (err: unknown) {
        sendSseEvent(res, 'run_failed', {
          error: {
            code: (err as any).code ?? 'INTERNAL_AGENT_ERROR',
            message: (err as Error).message,
          },
        });
      } finally {
        res.end();
      }
      return;
    }

    const result = await this.resumeRunUseCase.execute(
      runId,
      body,
      { tenantId, actorId },
      { signal: context.signal },
    );

    sendJsonResponse(res, 200, result, context);
  }

  public async handleCancel(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    runId: AgentRunId,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const body = await parseJsonBody<CancelRunDto>(req);

    const result = await this.cancelRunUseCase.execute(runId, body, { tenantId });
    sendJsonResponse(res, 200, result, context);
  }
}
