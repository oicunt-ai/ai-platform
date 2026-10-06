import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RetrieveContextUseCase } from '../../../application/use-cases/index.js';
import type { RetrievalInputDto } from '../../../application/dtos/retrieval.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import {
  checkDeadline,
  parseJsonBody,
  sendErrorResponse,
  sendJsonResponse,
} from '../middleware.js';

export interface RetrievalControllerDependencies {
  readonly retrieveContextUseCase: RetrieveContextUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class RetrievalController {
  constructor(private readonly deps: RetrievalControllerDependencies) {}

  public async handleRetrieve(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const body = await parseJsonBody<RetrievalInputDto>(req, this.deps.maxBodySizeBytes);

      const result = await this.deps.retrieveContextUseCase.execute(
        {
          tenantId,
          correlationId: context.correlationId,
          deadlineMs: context.deadlineMs,
        },
        body,
        context.signal,
      );

      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
