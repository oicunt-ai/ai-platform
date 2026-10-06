import type { EmbeddingResult, EmbeddingVectorItem, EmbeddingUsage } from '../../domain/types.js';

export interface GenerateEmbeddingsResponseDto {
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  readonly embeddings: readonly EmbeddingVectorItem[];
  readonly usage: EmbeddingUsage;
}

export function toGenerateEmbeddingsResponseDto(
  result: EmbeddingResult,
): GenerateEmbeddingsResponseDto {
  return {
    model: result.model,
    modelVersion: result.modelVersion,
    dimensions: result.dimensions,
    embeddings: result.embeddings,
    usage: result.usage,
  };
}
