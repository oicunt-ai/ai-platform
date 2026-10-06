import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PurgeDataUseCase } from '../../../application/use-cases/index.js';
import type { PurgeRequestDto } from '../../../application/dtos/purge.dto.js';
import type { RequestContext } from '../context.js';
import {
  checkDeadline,
  parseJsonBody,
  sendErrorResponse,
  sendJsonResponse,
} from '../middleware.js';

export interface PurgeControllerDependencies {
  readonly purgeDataUseCase: PurgeDataUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class PurgeController {
  constructor(private readonly deps: PurgeControllerDependencies) {}

  public async handlePurge(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    tenantId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);

      const body = await parseJsonBody<PurgeRequestDto>(req, this.deps.maxBodySizeBytes);

      const result = await this.deps.purgeDataUseCase.execute(body, {
        tenantId,
        callerServiceName: context.serviceName,
        signal: context.signal,
      });

      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
