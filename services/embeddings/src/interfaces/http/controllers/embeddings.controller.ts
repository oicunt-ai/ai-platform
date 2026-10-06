import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GenerateEmbeddingsUseCase } from '../../../application/use-cases/generate-embeddings.use-case.js';
import type { GenerateEmbeddingsInputDto } from '../../../application/dtos/embedding-request.dto.js';
import { toGenerateEmbeddingsResponseDto } from '../../../application/dtos/embedding-response.dto.js';
import type { EmbeddingsLogger } from '../../../infrastructure/logging/logger.js';
import type { EmbeddingsMetrics } from '../../../infrastructure/observability/metrics.js';
import { validateInternalToken, validateTenantHeader } from '../auth.js';
import type { RequestContext } from '../context.js';
import { checkDeadline, parseJsonBody, sendJsonResponse } from '../middleware.js';

export interface EmbeddingsControllerOptions {
  readonly useCase: GenerateEmbeddingsUseCase;
  readonly logger: EmbeddingsLogger;
  readonly metrics?: EmbeddingsMetrics | undefined;
  readonly internalToken?: string | undefined;
  readonly maxBatchSize?: number | undefined;
}

export class EmbeddingsController {
  private readonly useCase: GenerateEmbeddingsUseCase;
  private readonly logger: EmbeddingsLogger;
  private readonly metrics?: EmbeddingsMetrics | undefined;
  private readonly internalToken?: string | undefined;

  constructor(options: EmbeddingsControllerOptions) {
    this.useCase = options.useCase;
    this.logger = options.logger;
    this.metrics = options.metrics;
    this.internalToken = options.internalToken;
  }

  public async embed(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    validateInternalToken(req, this.internalToken);
    const tenantId = validateTenantHeader(context);
    checkDeadline(context);

    const body = await parseJsonBody<GenerateEmbeddingsInputDto>(req);
    const requestedModel = body.model ?? 'unknown';

    try {
      const result = await this.useCase.execute(body, {
        requestId: context.requestId,
        correlationId: context.correlationId,
        tenantId,
        userId: context.userId,
        actorId: context.actorId,
        deadlineMs: context.deadlineMs,
        signal: context.signal,
      });

      const latencyMs = Date.now() - context.startTime;

      if (this.metrics) {
        this.metrics.recordRequest(result.model, tenantId, 'success');
        this.metrics.recordInputs(result.model, tenantId, result.embeddings.length);
        this.metrics.recordTokens(result.model, tenantId, result.usage.promptTokens);
        this.metrics.recordDuration(result.model, 'success', latencyMs);
        this.metrics.recordBatchSize(result.model, result.embeddings.length);
      }

      const totalCharacters = body.inputs
        ? body.inputs.reduce((sum, item) => sum + (typeof item === 'string' ? item.length : 0), 0)
        : 0;

      this.logger.info('Embeddings generated successfully', {
        tenantId,
        model: result.model,
        modelVersion: result.modelVersion,
        batchSize: result.embeddings.length,
        totalCharacters,
        promptTokens: result.usage.promptTokens,
        dimensions: result.dimensions,
        latencyMs,
        requestId: context.requestId,
        correlationId: context.correlationId,
      });

      const responseDto = toGenerateEmbeddingsResponseDto(result);
      sendJsonResponse(res, 200, responseDto, context);
    } catch (err: unknown) {
      if (this.metrics) {
        const errorCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code: unknown }).code)
            : 'INTERNAL_EMBEDDING_ERROR';
        this.metrics.recordError(errorCode, requestedModel);
        this.metrics.recordRequest(requestedModel, tenantId, 'error');
        this.metrics.recordDuration(requestedModel, 'error', Date.now() - context.startTime);
      }
      throw err;
    }
  }
}
