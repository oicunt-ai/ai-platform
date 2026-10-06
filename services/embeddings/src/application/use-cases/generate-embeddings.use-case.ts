import type { ModelRegistryPort } from '../ports/model-registry.port.js';
import type { ModelGatewayPort } from '../ports/model-gateway.port.js';
import type {
  GenerateEmbeddingsInputDto,
  GenerateEmbeddingsContextDto,
} from '../dtos/embedding-request.dto.js';
import type { GenerateEmbeddingsResponseDto } from '../dtos/embedding-response.dto.js';
import { toGenerateEmbeddingsResponseDto } from '../dtos/embedding-response.dto.js';
import {
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_MAX_ITEM_CHARACTERS,
  DEFAULT_EMBEDDING_DIMENSIONS,
} from '../../domain/types.js';
import {
  DeadlineExceededError,
  EmbeddingsError,
  InvalidRequestError,
  ModelUnavailableError,
  RequestCancelledError,
  UnsupportedModelError,
} from '../../domain/errors.js';
import {
  validateBatchBounds,
  validateInputItems,
  validateModelModality,
  validateRequestedDimensions,
  validateReturnedVectors,
} from '../../domain/validation.js';

export interface GenerateEmbeddingsUseCaseOptions {
  readonly maxBatchSize?: number | undefined;
  readonly maxItemCharacters?: number | undefined;
  readonly defaultTimeoutMs?: number | undefined;
}

export class GenerateEmbeddingsUseCase {
  private readonly maxBatchSize: number;
  private readonly maxItemCharacters: number;
  private readonly defaultTimeoutMs: number;

  constructor(
    private readonly modelRegistry: ModelRegistryPort,
    private readonly modelGateway: ModelGatewayPort,
    options: GenerateEmbeddingsUseCaseOptions = {},
  ) {
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.maxItemCharacters = options.maxItemCharacters ?? DEFAULT_MAX_ITEM_CHARACTERS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
  }

  public async execute(
    dto: GenerateEmbeddingsInputDto,
    context: GenerateEmbeddingsContextDto,
    signal?: AbortSignal,
  ): Promise<GenerateEmbeddingsResponseDto> {
    // 1. Check early cancellation
    if (signal?.aborted) {
      throw new RequestCancelledError('Embedding request cancelled by caller before execution');
    }

    // 2. Validate request metadata
    if (!dto.model || typeof dto.model !== 'string' || dto.model.trim().length === 0) {
      throw new InvalidRequestError('The model field is required and must not be empty');
    }

    if (
      !context.tenantId ||
      typeof context.tenantId !== 'string' ||
      context.tenantId.trim().length === 0
    ) {
      throw new InvalidRequestError('Tenant identity (tenantId) is required');
    }

    // 3. Validate batch bounds and input items
    validateBatchBounds(dto.inputs, this.maxBatchSize);
    const validatedItems = validateInputItems(dto.inputs, this.maxItemCharacters);

    // 4. Calculate deadline budget
    const now = Date.now();
    let effectiveDeadlineMs: number | undefined;

    if (context.deadlineAt) {
      const parsedDeadline = new Date(context.deadlineAt).getTime();
      if (!Number.isNaN(parsedDeadline)) {
        if (parsedDeadline <= now) {
          throw new DeadlineExceededError('Deadline exceeded before embedding generation started');
        }
        effectiveDeadlineMs = parsedDeadline;
      }
    } else if (context.deadlineMs) {
      if (context.deadlineMs <= now) {
        throw new DeadlineExceededError('Deadline exceeded before embedding generation started');
      }
      effectiveDeadlineMs = context.deadlineMs;
    } else {
      effectiveDeadlineMs = now + this.defaultTimeoutMs;
    }

    // 5. Resolve Canonical Model via Model Registry
    let resolvedModel;
    try {
      resolvedModel = await this.modelRegistry.resolveModel(
        {
          canonicalModelId: dto.model.trim(),
          tenantId: context.tenantId,
          correlationId: context.correlationId,
        },
        signal,
      );
    } catch (err: unknown) {
      if (err instanceof EmbeddingsError) {
        throw err;
      }
      if (err instanceof Error && err.name === 'RequestCancelledError') {
        throw new RequestCancelledError();
      }
      if (err instanceof Error && err.name === 'DeadlineExceededError') {
        throw new DeadlineExceededError();
      }
      throw new UnsupportedModelError(dto.model, err);
    }

    // 6. Validate model capability and availability
    if (resolvedModel.status === 'maintenance' || resolvedModel.status === 'deprecated') {
      throw new ModelUnavailableError(
        `Model '${dto.model}' is currently in status '${resolvedModel.status}' and unavailable for embedding generation`,
      );
    }

    validateModelModality(resolvedModel.modalities, dto.model);

    if (!resolvedModel.eligibleTargets || resolvedModel.eligibleTargets.length === 0) {
      throw new ModelUnavailableError(
        `No eligible provider execution targets available for model '${dto.model}'`,
      );
    }

    // 7. Validate and resolve dimensions
    const modelMetadata = resolvedModel.metadata as Record<string, unknown> | undefined;
    const modelDimensions =
      typeof modelMetadata?.['dimensions'] === 'number'
        ? modelMetadata['dimensions']
        : DEFAULT_EMBEDDING_DIMENSIONS;
    const supportedDimensions = Array.isArray(modelMetadata?.['supportedDimensions'])
      ? (modelMetadata['supportedDimensions'] as readonly number[])
      : undefined;

    const effectiveDimensions = validateRequestedDimensions(
      dto.dimensions,
      modelDimensions,
      supportedDimensions,
    );

    // 8. Re-check cancellation before downstream dispatch
    if (signal?.aborted) {
      throw new RequestCancelledError('Embedding request cancelled by caller before dispatch');
    }

    // 9. Dispatch execution to Model Gateway
    const dispatchResult = await this.modelGateway.dispatchEmbeddings(
      {
        requestId: context.requestId,
        correlationId: context.correlationId,
        canonicalModelId: String(resolvedModel.canonicalModelId),
        version: resolvedModel.version,
        inputs: validatedItems.map((item) => item.text),
        dimensions: effectiveDimensions,
        eligibleTargets: resolvedModel.eligibleTargets,
        routingPolicy: resolvedModel.routingPolicy,
        tenantId: context.tenantId,
        userId: context.userId,
        deadlineMs: effectiveDeadlineMs,
        metadata: dto.metadata,
      },
      signal,
    );

    // 10. Post-execution dimension and count validation
    validateReturnedVectors(dispatchResult.vectors, validatedItems.length, effectiveDimensions);

    // 11. Normalize atomic output preserving strict positional indexing
    const embeddings = dispatchResult.vectors.map((vector, index) => ({
      index,
      vector,
    }));

    const estimatedTokens = validatedItems.reduce((acc, item) => acc + item.tokenEstimate, 0);
    const usage = {
      promptTokens: dispatchResult.usage?.promptTokens ?? estimatedTokens,
      totalTokens: dispatchResult.usage?.totalTokens ?? estimatedTokens,
    };

    return toGenerateEmbeddingsResponseDto({
      model: String(resolvedModel.canonicalModelId),
      modelVersion: resolvedModel.version,
      dimensions: effectiveDimensions,
      embeddings,
      usage,
    });
  }
}
