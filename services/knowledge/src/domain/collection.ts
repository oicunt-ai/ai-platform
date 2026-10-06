import type { EmbeddingModelConfig } from './types.js';
import { InvalidRequestError } from './errors.js';

export interface KnowledgeCollection {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description?: string | undefined;
  /** Embedding configuration locked at collection creation */
  readonly embeddingConfig: EmbeddingModelConfig;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCollectionParams {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly embeddingConfig: EmbeddingModelConfig;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export function validateCollectionParams(params: CreateCollectionParams): void {
  if (!params.id || params.id.trim().length === 0) {
    throw new InvalidRequestError('Collection id must not be empty');
  }
  if (!params.tenantId || params.tenantId.trim().length === 0) {
    throw new InvalidRequestError('Collection tenantId must not be empty');
  }
  if (!params.name || params.name.trim().length === 0) {
    throw new InvalidRequestError('Collection name must not be empty');
  }
  if (
    !params.embeddingConfig ||
    !params.embeddingConfig.modelId ||
    params.embeddingConfig.modelId.trim().length === 0
  ) {
    throw new InvalidRequestError('Collection embeddingConfig.modelId must not be empty');
  }
  if (!params.embeddingConfig.dimensions || params.embeddingConfig.dimensions <= 0) {
    throw new InvalidRequestError(
      'Collection embeddingConfig.dimensions must be a positive integer',
    );
  }
  if (!params.embeddingConfig.version || params.embeddingConfig.version.trim().length === 0) {
    throw new InvalidRequestError('Collection embeddingConfig.version must not be empty');
  }
}

export function createKnowledgeCollection(params: CreateCollectionParams): KnowledgeCollection {
  validateCollectionParams(params);
  const now = new Date().toISOString();
  return {
    id: params.id,
    tenantId: params.tenantId.trim(),
    name: params.name.trim(),
    description: params.description?.trim(),
    embeddingConfig: {
      modelId: params.embeddingConfig.modelId.trim(),
      dimensions: params.embeddingConfig.dimensions,
      version: params.embeddingConfig.version.trim(),
    },
    metadata: params.metadata ?? {},
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}
