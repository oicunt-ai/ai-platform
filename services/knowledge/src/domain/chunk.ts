import type { EmbeddingModelConfig } from './types.js';
import { InvalidRequestError } from './errors.js';

export interface DocumentChunk {
  readonly id: string;
  readonly tenantId: string;
  readonly collectionId: string;
  readonly documentId: string;
  /** 0-indexed position within the parent document */
  readonly chunkIndex: number;
  /** Sanitized textual content */
  readonly text: string;
  /** Estimated token count for prompt budgeting */
  readonly tokenEstimate: number;
  /** Reference ID in the vector index store */
  readonly vectorId?: string | undefined;
  /** Embedding model metadata used to generate this vector */
  readonly embeddingMetadata: EmbeddingModelConfig;
  /** Granular provenance metadata (e.g. page numbers, section headers) */
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface CreateChunkParams {
  readonly id: string;
  readonly tenantId: string;
  readonly collectionId: string;
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly tokenEstimate?: number | undefined;
  readonly vectorId?: string | undefined;
  readonly embeddingMetadata: EmbeddingModelConfig;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly createdAt?: string | undefined;
}

export function createDocumentChunk(params: CreateChunkParams): DocumentChunk {
  if (!params.id || params.id.trim().length === 0) {
    throw new InvalidRequestError('Chunk id must not be empty');
  }
  if (!params.tenantId || params.tenantId.trim().length === 0) {
    throw new InvalidRequestError('Chunk tenantId must not be empty');
  }
  if (!params.documentId || params.documentId.trim().length === 0) {
    throw new InvalidRequestError('Chunk documentId must not be empty');
  }
  if (!params.text || params.text.trim().length === 0) {
    throw new InvalidRequestError('Chunk text must not be empty');
  }
  if (params.chunkIndex < 0) {
    throw new InvalidRequestError('Chunk chunkIndex must be non-negative');
  }

  const tokenEstimate = params.tokenEstimate ?? Math.max(1, Math.ceil(params.text.length / 4));
  const now = new Date().toISOString();

  return {
    id: params.id,
    tenantId: params.tenantId.trim(),
    collectionId: params.collectionId.trim(),
    documentId: params.documentId.trim(),
    chunkIndex: params.chunkIndex,
    text: params.text,
    tokenEstimate,
    vectorId: params.vectorId,
    embeddingMetadata: params.embeddingMetadata,
    metadata: params.metadata ?? {},
    createdAt: params.createdAt ?? now,
  };
}
