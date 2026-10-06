import type {
  VectorStorePort,
  VectorUpsertItem,
  VectorSearchQuery,
  VectorSearchResult,
} from '../../application/ports/vector-store.port.js';
import { RequestCancelledError } from '../../domain/index.js';

export class InMemoryVectorStore implements VectorStorePort {
  private readonly items = new Map<string, VectorUpsertItem>();

  public async upsertVectors(
    items: readonly VectorUpsertItem[],
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new RequestCancelledError('Vector upsert cancelled');
    }
    for (const item of items) {
      this.items.set(`${item.tenantId}:${item.id}`, item);
    }
  }

  public async searchVectors(
    query: VectorSearchQuery,
    signal?: AbortSignal,
  ): Promise<readonly VectorSearchResult[]> {
    if (signal?.aborted) {
      throw new RequestCancelledError('Vector search cancelled');
    }

    const collectionSet = new Set(query.collectionIds);
    const candidates: { id: string; score: number; payload: Record<string, unknown> }[] = [];

    for (const item of this.items.values()) {
      // Mandatory tenant isolation filter
      if (item.tenantId !== query.tenantId) {
        continue;
      }
      // Mandatory collection scope filter
      if (!collectionSet.has(item.collectionId)) {
        continue;
      }

      // Metadata filter matching if specified
      if (query.filter) {
        let matches = true;
        for (const [key, val] of Object.entries(query.filter)) {
          if (item.payload[key] !== val) {
            matches = false;
            break;
          }
        }
        if (!matches) {
          continue;
        }
      }

      const score = this.cosineSimilarity(query.vector, item.vector);
      if (query.minScore !== undefined && score < query.minScore) {
        continue;
      }

      candidates.push({
        id: item.id,
        score,
        payload: item.payload,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, query.topK);
  }

  public async deleteVectorsByDocument(
    tenantId: string,
    documentId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new RequestCancelledError('Vector deletion cancelled');
    }
    for (const [key, item] of this.items.entries()) {
      if (item.tenantId === tenantId && item.documentId === documentId) {
        this.items.delete(key);
      }
    }
  }

  public async deleteVectorsByCollection(
    tenantId: string,
    collectionId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new RequestCancelledError('Vector deletion cancelled');
    }
    for (const [key, item] of this.items.entries()) {
      if (item.tenantId === tenantId && item.collectionId === collectionId) {
        this.items.delete(key);
      }
    }
  }

  public async purgeTenantVectors(tenantId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new RequestCancelledError('Tenant vector purge cancelled');
    }
    for (const [key, item] of this.items.entries()) {
      if (item.tenantId === tenantId) {
        this.items.delete(key);
      }
    }
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }

  private cosineSimilarity(a: readonly number[], b: readonly number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const valA = a[i]!;
      const valB = b[i]!;
      dot += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
