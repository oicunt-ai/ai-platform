import type { ChunkProvenance, RetrievedChunk, RetrievalQuery, RetrievalResult } from './types.js';
import { InvalidRequestError } from './errors.js';

export const DEFAULT_RETRIEVAL_TOP_K = 5;
export const MAX_RETRIEVAL_TOP_K = 50;
export const MIN_RETRIEVAL_TOP_K = 1;

export function validateRetrievalQuery(query: RetrievalQuery): void {
  if (!query.query || query.query.trim().length === 0) {
    throw new InvalidRequestError('Retrieval query must not be empty');
  }
  if (!query.collectionIds || query.collectionIds.length === 0) {
    throw new InvalidRequestError('Retrieval collectionIds must not be empty');
  }
  for (const id of query.collectionIds) {
    if (!id || id.trim().length === 0) {
      throw new InvalidRequestError('Collection ID in collectionIds cannot be empty');
    }
  }
  if (query.topK < MIN_RETRIEVAL_TOP_K || query.topK > MAX_RETRIEVAL_TOP_K) {
    throw new InvalidRequestError(
      `Retrieval topK must be between ${MIN_RETRIEVAL_TOP_K} and ${MAX_RETRIEVAL_TOP_K} (requested: ${query.topK})`,
    );
  }
  if (query.minScore !== undefined && (query.minScore < 0 || query.minScore > 1)) {
    throw new InvalidRequestError(
      `Retrieval minScore must be between 0.0 and 1.0 (requested: ${query.minScore})`,
    );
  }
}

export function buildChunkProvenance(params: {
  documentId: string;
  collectionId: string;
  documentTitle: string;
  chunkIndex: number;
  sourceUri?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}): ChunkProvenance {
  return {
    documentId: params.documentId,
    collectionId: params.collectionId,
    documentTitle: params.documentTitle,
    chunkIndex: params.chunkIndex,
    sourceUri: params.sourceUri,
    metadata: params.metadata ?? {},
  };
}

export function buildRetrievalResult(params: {
  query: string;
  chunks: readonly RetrievedChunk[];
  totalChunksEvaluated: number;
  latencyMs: number;
}): RetrievalResult {
  const totalTokens = params.chunks.reduce((acc, c) => acc + c.tokenEstimate, 0);
  return {
    query: params.query,
    chunks: params.chunks,
    totalChunksEvaluated: params.totalChunksEvaluated,
    returnedCount: params.chunks.length,
    totalTokens,
    latencyMs: params.latencyMs,
  };
}
