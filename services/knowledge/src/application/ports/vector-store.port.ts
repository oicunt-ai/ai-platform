export interface VectorUpsertItem {
  readonly id: string; // chunk ID
  readonly tenantId: string;
  readonly collectionId: string;
  readonly documentId: string;
  readonly vector: readonly number[];
  readonly payload: Record<string, unknown>;
}

export interface VectorSearchQuery {
  readonly tenantId: string;
  readonly collectionIds: readonly string[];
  readonly vector: readonly number[];
  readonly topK: number;
  readonly minScore?: number | undefined;
  readonly filter?: Record<string, unknown> | undefined;
}

export interface VectorSearchResult {
  readonly id: string; // chunk ID
  readonly score: number;
  readonly payload: Record<string, unknown>;
}

export interface VectorStorePort {
  upsertVectors(items: readonly VectorUpsertItem[], signal?: AbortSignal): Promise<void>;
  searchVectors(
    query: VectorSearchQuery,
    signal?: AbortSignal,
  ): Promise<readonly VectorSearchResult[]>;
  deleteVectorsByDocument(
    tenantId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  deleteVectorsByCollection(
    tenantId: string,
    collectionId: string,
    signal?: AbortSignal,
  ): Promise<void>;
  purgeTenantVectors(tenantId: string, signal?: AbortSignal): Promise<void>;
  checkHealth(signal?: AbortSignal): Promise<boolean>;
}
