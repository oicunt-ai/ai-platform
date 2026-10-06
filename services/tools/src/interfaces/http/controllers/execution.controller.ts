import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ToolExecutionRequest } from '../../../domain/index.js';
import type {
  CancelExecutionUseCase,
  ExecuteToolAsyncUseCase,
  ExecuteToolSyncUseCase,
  GetExecutionStatusUseCase,
} from '../../../application/use-cases/index.js';
import type { RequestContext } from '../context.js';
import { validateActorHeader, validateTenantHeader, validateUserHeader } from '../auth.js';
import { parseJsonBody, sendJsonResponse } from '../middleware.js';

export class ExecutionController {
  constructor(
    private readonly executeSyncUseCase: ExecuteToolSyncUseCase,
    private readonly executeAsyncUseCase: ExecuteToolAsyncUseCase,
    private readonly getStatusUseCase: GetExecutionStatusUseCase,
    private readonly cancelUseCase: CancelExecutionUseCase,
  ) {}

  public async handleExecuteSync(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const userId = validateUserHeader(context);
    const actorId = validateActorHeader(context);

    const body = await parseJsonBody<ToolExecutionRequest>(req);

    const result = await this.executeSyncUseCase.execute({
      request: body,
      tenantId,
      userId,
      actorId,
      actorRoles: context.actorRoles,
      correlationId: context.correlationId,
      requestId: context.requestId,
      deadlineAt: context.deadlineAt,
      deadlineMs: context.deadlineMs,
      idempotencyKey: context.idempotencyKey,
      clientIp: context.clientIp,
      signal: context.signal,
    });

    sendJsonResponse(res, 200, result, context);
  }

  public async handleExecuteAsync(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);
    const userId = validateUserHeader(context);
    const actorId = validateActorHeader(context);

    const body = await parseJsonBody<ToolExecutionRequest>(req);

    const result = await this.executeAsyncUseCase.execute({
      request: body,
      tenantId,
      userId,
      actorId,
      actorRoles: context.actorRoles,
      correlationId: context.correlationId,
      requestId: context.requestId,
      clientIp: context.clientIp,
    });

    sendJsonResponse(res, 202, result, context);
  }

  public async handleGetStatus(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    executionId: string,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);

    const job = await this.getStatusUseCase.execute({
      executionId,
      tenantId,
    });

    sendJsonResponse(res, 200, job, context);
  }

  public async handleCancel(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    executionId: string,
  ): Promise<void> {
    const tenantId = validateTenantHeader(context);

    const result = await this.cancelUseCase.execute({
      executionId,
      tenantId,
    });

    sendJsonResponse(res, 200, result, context);
  }
}
