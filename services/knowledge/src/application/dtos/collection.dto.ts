import type { EmbeddingModelConfig, KnowledgeCollection } from '../../domain/index.js';

export interface CreateCollectionInputDto {
  readonly name: string;
  readonly description?: string | undefined;
  readonly embeddingConfig: EmbeddingModelConfig;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface CollectionResponseDto {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly embeddingConfig: EmbeddingModelConfig;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function toCollectionResponseDto(collection: KnowledgeCollection): CollectionResponseDto {
  return {
    id: collection.id,
    tenantId: collection.tenantId,
    name: collection.name,
    description: collection.description,
    embeddingConfig: collection.embeddingConfig,
    metadata: collection.metadata,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}
