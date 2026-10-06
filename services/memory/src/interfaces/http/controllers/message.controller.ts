import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  AppendMessagesUseCase,
  ListMessagesUseCase,
} from '../../../application/use-cases/index.js';
import type { AppendMessagesRequestDto } from '../../../application/dtos/message.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import {
  checkDeadline,
  parseJsonBody,
  sendErrorResponse,
  sendJsonResponse,
} from '../middleware.js';

export interface MessageControllerDependencies {
  readonly appendMessagesUseCase: AppendMessagesUseCase;
  readonly listMessagesUseCase: ListMessagesUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class MessageController {
  constructor(private readonly deps: MessageControllerDependencies) {}

  public async handleAppend(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    conversationId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const body = await parseJsonBody<AppendMessagesRequestDto>(req, this.deps.maxBodySizeBytes);

      const result = await this.deps.appendMessagesUseCase.execute(conversationId, body, {
        tenantId,
        userId: context.userId,
        callerServiceName: context.serviceName,
        signal: context.signal,
      });

      sendJsonResponse(res, 201, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleList(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    conversationId: string,
    queryParams: URLSearchParams,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const afterSeqStr = queryParams.get('afterSequence');
      const beforeSeqStr = queryParams.get('beforeSequence');
      const limitStr = queryParams.get('limit');
      const order = (queryParams.get('order') as 'asc' | 'desc') ?? undefined;

      const afterSequence = afterSeqStr ? Number.parseInt(afterSeqStr, 10) : undefined;
      const beforeSequence = beforeSeqStr ? Number.parseInt(beforeSeqStr, 10) : undefined;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;

      const result = await this.deps.listMessagesUseCase.execute(
        conversationId,
        {
          afterSequence,
          beforeSequence,
          limit,
          order,
        },
        {
          tenantId,
          userId: context.userId,
          callerServiceName: context.serviceName,
          signal: context.signal,
        },
      );

      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
