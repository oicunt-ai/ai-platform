import type { ServerResponse } from 'node:http';
import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { ResolveModelUseCase } from '../../../application/use-cases/resolve-model.use-case.js';
import type { RequestContext } from '../context.js';
import { sendJsonResponse } from '../middleware.js';

export class ResolutionController {
  constructor(private readonly resolveModelUseCase: ResolveModelUseCase) {}

  public async handleResolve(
    res: ServerResponse,
    canonicalModelId: string,
    url: URL,
    context: RequestContext,
  ): Promise<void> {
    const versionParam = url.searchParams.get('version')?.trim() || undefined;

    const response = await this.resolveModelUseCase.execute({
      canonicalModelId: canonicalModelId as CanonicalModelId,
      version: versionParam,
      tenantId: context.tenantId,
      correlationId: context.correlationId,
    });

    sendJsonResponse(res, 200, response, context);
  }
}
