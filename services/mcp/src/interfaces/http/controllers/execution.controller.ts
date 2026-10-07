import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecuteToolUseCase } from '../../../application/use-cases/index.js';
import type { ExecuteMcpToolDto } from '../../../application/dtos/mcp.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import { parseJsonBody, sendJsonResponse } from '../middleware.js';

export class ExecutionController {
  constructor(private readonly executeToolUseCase: ExecuteToolUseCase) {}

  public async handleExecute(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const tenantId = context.tenantId || validateTenantHeader(context);
    const body = await parseJsonBody<Partial<ExecuteMcpToolDto>>(req);

    const result = await this.executeToolUseCase.execute({
      tenantId: body.tenantId || tenantId,
      serverId: body.serverId ?? '',
      toolName: body.toolName ?? '',
      arguments: body.arguments ?? {},
      actorId: body.actorId ?? context.actorId,
      correlationId: body.correlationId ?? context.correlationId,
      deadlineMs: body.deadlineMs ?? context.deadlineMs,
      signal: context.signal,
    });

    sendJsonResponse(res, 200, result, context);
  }
}
