import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PurgeTenantKnowledgeUseCase } from '../../../application/use-cases/index.js';
import type { RequestContext } from '../context.js';
import { checkDeadline, sendErrorResponse, sendJsonResponse } from '../middleware.js';

export interface AdminControllerDependencies {
  readonly purgeTenantKnowledgeUseCase: PurgeTenantKnowledgeUseCase;
}

export class AdminController {
  constructor(private readonly deps: AdminControllerDependencies) {}

  public async handlePurgeTenant(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    tenantId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);

      const result = await this.deps.purgeTenantKnowledgeUseCase.execute(tenantId);
      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
