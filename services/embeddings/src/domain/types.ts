import type { CanonicalModelId } from '@oicunt-ai/model-types';

export const DEFAULT_MAX_BATCH_SIZE = 256;
export const DEFAULT_MAX_ITEM_CHARACTERS = 32768; // ~8192 tokens approximation (4 chars/token)
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * Validated individual input text item within an embedding request.
 */
export interface EmbeddingInputItem {
  readonly index: number;
  readonly text: string;
  readonly characterCount: number;
  readonly tokenEstimate: number;
}

/**
 * Individual generated dense vector corresponding to an input item index.
 */
export interface EmbeddingVectorItem {
  readonly index: number;
  readonly vector: readonly number[];
}

/**
 * Token usage telemetry reported for the embedding operation.
 */
export interface EmbeddingUsage {
  readonly promptTokens: number;
  readonly totalTokens: number;
}

/**
 * Resolved model identity and configuration metadata.
 */
export interface EmbeddingModelMetadata {
  readonly model: CanonicalModelId | string;
  readonly version: string;
  readonly dimensions: number;
}

/**
 * Normalized result of an embedding generation execution.
 */
export interface EmbeddingResult {
  readonly model: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  readonly embeddings: readonly EmbeddingVectorItem[];
  readonly usage: EmbeddingUsage;
}
