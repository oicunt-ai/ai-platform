import type { DocumentRepositoryPort } from '../../application/ports/document-repository.port.js';
import type {
  KnowledgeCollection,
  Document,
  DocumentChunk,
  DocumentStatus,
  DocumentErrorDetails,
} from '../../domain/index.js';

export class InMemoryDocumentRepository implements DocumentRepositoryPort {
  private readonly collections = new Map<string, KnowledgeCollection>();
  private readonly documents = new Map<string, Document>();
  private readonly chunks = new Map<string, DocumentChunk>();

  // Collections
  public async createCollection(collection: KnowledgeCollection): Promise<void> {
    this.collections.set(`${collection.tenantId}:${collection.id}`, collection);
  }

  public async getCollection(
    tenantId: string,
    collectionId: string,
  ): Promise<KnowledgeCollection | null> {
    return this.collections.get(`${tenantId}:${collectionId}`) ?? null;
  }

  public async getCollectionByName(
    tenantId: string,
    name: string,
  ): Promise<KnowledgeCollection | null> {
    for (const col of this.collections.values()) {
      if (col.tenantId === tenantId && col.name === name) {
        return col;
      }
    }
    return null;
  }

  public async listCollections(tenantId: string): Promise<readonly KnowledgeCollection[]> {
    const results: KnowledgeCollection[] = [];
    for (const col of this.collections.values()) {
      if (col.tenantId === tenantId) {
        results.push(col);
      }
    }
    return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  public async deleteCollection(tenantId: string, collectionId: string): Promise<boolean> {
    const key = `${tenantId}:${collectionId}`;
    if (!this.collections.has(key)) {
      return false;
    }
    this.collections.delete(key);

    // Delete child documents and chunks
    for (const [docKey, doc] of this.documents.entries()) {
      if (doc.tenantId === tenantId && doc.collectionId === collectionId) {
        this.documents.delete(docKey);
      }
    }
    for (const [chunkKey, chunk] of this.chunks.entries()) {
      if (chunk.tenantId === tenantId && chunk.collectionId === collectionId) {
        this.chunks.delete(chunkKey);
      }
    }
    return true;
  }

  // Documents
  public async createDocument(doc: Document): Promise<void> {
    this.documents.set(`${doc.tenantId}:${doc.id}`, doc);
  }

  public async updateDocumentStatus(
    tenantId: string,
    documentId: string,
    status: DocumentStatus,
    error?: DocumentErrorDetails | undefined,
    updates?: {
      readonly totalChunks?: number | undefined;
      readonly totalTokens?: number | undefined;
      readonly indexedAt?: string | undefined;
    },
  ): Promise<void> {
    const key = `${tenantId}:${documentId}`;
    const existing = this.documents.get(key);
    if (!existing) {
      return;
    }

    if (existing.status === 'deleted' && status !== 'deleted') {
      return;
    }

    const updated: Document = {
      ...existing,
      status,
      error,
      totalChunks: updates?.totalChunks ?? existing.totalChunks,
      totalTokens: updates?.totalTokens ?? existing.totalTokens,
      indexedAt: updates?.indexedAt ?? existing.indexedAt,
      updatedAt: new Date().toISOString(),
      deletedAt: status === 'deleted' ? new Date().toISOString() : existing.deletedAt,
    };
    this.documents.set(key, updated);
  }

  public async getDocument(tenantId: string, documentId: string): Promise<Document | null> {
    return this.documents.get(`${tenantId}:${documentId}`) ?? null;
  }

  public async getDocumentByHash(
    tenantId: string,
    collectionId: string,
    documentHash: string,
  ): Promise<Document | null> {
    for (const doc of this.documents.values()) {
      if (
        doc.tenantId === tenantId &&
        doc.collectionId === collectionId &&
        doc.documentHash === documentHash &&
        doc.status !== 'deleted'
      ) {
        return doc;
      }
    }
    return null;
  }

  public async listDocuments(
    tenantId: string,
    collectionId: string,
    options?: {
      readonly status?: DocumentStatus | undefined;
      readonly limit?: number | undefined;
      readonly offset?: number | undefined;
    },
  ): Promise<{ readonly documents: readonly Document[]; readonly totalCount: number }> {
    let matched: Document[] = [];
    for (const doc of this.documents.values()) {
      if (doc.tenantId === tenantId && doc.collectionId === collectionId) {
        if (!options?.status || doc.status === options.status) {
          matched.push(doc);
        }
      }
    }

    matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const totalCount = matched.length;

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    matched = matched.slice(offset, offset + limit);

    return { documents: matched, totalCount };
  }

  public async markDocumentDeleted(tenantId: string, documentId: string): Promise<boolean> {
    const key = `${tenantId}:${documentId}`;
    const doc = this.documents.get(key);
    if (!doc) {
      return false;
    }
    this.documents.set(key, {
      ...doc,
      status: 'deleted',
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  // Chunks
  public async saveChunks(chunks: readonly DocumentChunk[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(`${chunk.tenantId}:${chunk.id}`, chunk);
    }
  }

  public async getChunksByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<readonly DocumentChunk[]> {
    const results: DocumentChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.tenantId === tenantId && chunk.documentId === documentId) {
        results.push(chunk);
      }
    }
    return results.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  public async getChunksByIds(
    tenantId: string,
    chunkIds: readonly string[],
  ): Promise<readonly DocumentChunk[]> {
    const results: DocumentChunk[] = [];
    for (const id of chunkIds) {
      const chunk = this.chunks.get(`${tenantId}:${id}`);
      if (chunk) {
        results.push(chunk);
      }
    }
    return results;
  }

  public async deleteChunksByDocument(tenantId: string, documentId: string): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks.entries()) {
      if (chunk.tenantId === tenantId && chunk.documentId === documentId) {
        this.chunks.delete(key);
        count++;
      }
    }
    return count;
  }

  public async deleteChunksByCollection(tenantId: string, collectionId: string): Promise<number> {
    let count = 0;
    for (const [key, chunk] of this.chunks.entries()) {
      if (chunk.tenantId === tenantId && chunk.collectionId === collectionId) {
        this.chunks.delete(key);
        count++;
      }
    }
    return count;
  }

  // Tenant Purge
  public async purgeTenantData(tenantId: string): Promise<{
    readonly collectionsDeleted: number;
    readonly documentsDeleted: number;
    readonly chunksDeleted: number;
  }> {
    let collectionsDeleted = 0;
    let documentsDeleted = 0;
    let chunksDeleted = 0;

    for (const [key, col] of this.collections.entries()) {
      if (col.tenantId === tenantId) {
        this.collections.delete(key);
        collectionsDeleted++;
      }
    }

    for (const [key, doc] of this.documents.entries()) {
      if (doc.tenantId === tenantId) {
        this.documents.delete(key);
        documentsDeleted++;
      }
    }

    for (const [key, chunk] of this.chunks.entries()) {
      if (chunk.tenantId === tenantId) {
        this.chunks.delete(key);
        chunksDeleted++;
      }
    }

    return { collectionsDeleted, documentsDeleted, chunksDeleted };
  }

  public async checkHealth(): Promise<boolean> {
    return true;
  }
}
