import type { RetrievedChunk, RetrievalResult } from '../../domain/index.js';

export interface RetrievalInputDto {
  readonly query: string;
  readonly collectionIds: readonly string[];
  readonly topK?: number | undefined;
  readonly minScore?: number | undefined;
  readonly metadataFilters?: Record<string, unknown> | undefined;
}

export interface RetrievalResponseDto {
  readonly query: string;
  readonly chunks: readonly RetrievedChunk[];
  readonly totalChunksEvaluated: number;
  readonly returnedCount: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
}

export function toRetrievalResponseDto(result: RetrievalResult): RetrievalResponseDto {
  return {
    query: result.query,
    chunks: result.chunks,
    totalChunksEvaluated: result.totalChunksEvaluated,
    returnedCount: result.returnedCount,
    totalTokens: result.totalTokens,
    latencyMs: result.latencyMs,
  };
}
