export interface EmbeddingModelConfig {
  /** Canonical embedding model identifier (e.g. 'text-embedding-3-small', 'bge-large-en') */
  readonly modelId: string;
  /** Embedding vector dimensions (e.g. 1536, 1024, 768) */
  readonly dimensions: number;
  /** Model version string */
  readonly version: string;
}

export type DocumentStatus = 'created' | 'queued' | 'processing' | 'ready' | 'failed' | 'deleted';

export type DocumentProcessingPhase = 'extraction' | 'chunking' | 'embedding' | 'indexing';

export interface DocumentErrorDetails {
  readonly phase: DocumentProcessingPhase;
  readonly code: string;
  readonly message: string;
  readonly occurredAt: string;
}

export interface ChunkProvenance {
  readonly documentId: string;
  readonly collectionId: string;
  readonly documentTitle: string;
  readonly chunkIndex: number;
  readonly sourceUri?: string | undefined;
  readonly metadata: Record<string, unknown>;
}

export interface RetrievedChunk {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly tokenEstimate: number;
  readonly provenance: ChunkProvenance;
}

export interface RetrievalQuery {
  readonly query: string;
  readonly collectionIds: readonly string[];
  readonly topK: number;
  readonly minScore?: number | undefined;
  readonly metadataFilters?: Record<string, unknown> | undefined;
}

export interface RetrievalResult {
  readonly query: string;
  readonly chunks: readonly RetrievedChunk[];
  readonly totalChunksEvaluated: number;
  readonly returnedCount: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
}
