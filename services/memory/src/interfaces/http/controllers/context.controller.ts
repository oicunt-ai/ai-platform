import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GetContextUseCase } from '../../../application/use-cases/index.js';
import type { ContextRetrievalRequestDto } from '../../../application/dtos/context.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import {
  checkDeadline,
  parseJsonBody,
  sendErrorResponse,
  sendJsonResponse,
} from '../middleware.js';

export interface ContextControllerDependencies {
  readonly getContextUseCase: GetContextUseCase;
  readonly defaultMaxTokens?: number | undefined;
  readonly defaultMaxMessages?: number | undefined;
  readonly maxBodySizeBytes?: number | undefined;
}

export class ContextController {
  constructor(private readonly deps: ContextControllerDependencies) {}

  public async handleGetContext(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    conversationId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const body = await parseJsonBody<ContextRetrievalRequestDto>(req, this.deps.maxBodySizeBytes);

      const result = await this.deps.getContextUseCase.execute(conversationId, body, {
        tenantId,
        userId: context.userId,
        callerServiceName: context.serviceName,
        defaultMaxTokens: this.deps.defaultMaxTokens,
        defaultMaxMessages: this.deps.defaultMaxMessages,
        signal: context.signal,
      });

      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
