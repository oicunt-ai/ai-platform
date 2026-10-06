import type {
  KnowledgeCollection,
  Document,
  DocumentChunk,
  DocumentStatus,
  DocumentErrorDetails,
} from '../../domain/index.js';

export interface DocumentRepositoryPort {
  // Collections
  createCollection(collection: KnowledgeCollection): Promise<void>;
  getCollection(tenantId: string, collectionId: string): Promise<KnowledgeCollection | null>;
  getCollectionByName(tenantId: string, name: string): Promise<KnowledgeCollection | null>;
  listCollections(tenantId: string): Promise<readonly KnowledgeCollection[]>;
  deleteCollection(tenantId: string, collectionId: string): Promise<boolean>;

  // Documents
  createDocument(doc: Document): Promise<void>;
  updateDocumentStatus(
    tenantId: string,
    documentId: string,
    status: DocumentStatus,
    error?: DocumentErrorDetails | undefined,
    updates?: {
      readonly totalChunks?: number | undefined;
      readonly totalTokens?: number | undefined;
      readonly indexedAt?: string | undefined;
    },
  ): Promise<void>;
  getDocument(tenantId: string, documentId: string): Promise<Document | null>;
  getDocumentByHash(
    tenantId: string,
    collectionId: string,
    documentHash: string,
  ): Promise<Document | null>;
  listDocuments(
    tenantId: string,
    collectionId: string,
    options?: {
      readonly status?: DocumentStatus | undefined;
      readonly limit?: number | undefined;
      readonly offset?: number | undefined;
    },
  ): Promise<{ readonly documents: readonly Document[]; readonly totalCount: number }>;
  markDocumentDeleted(tenantId: string, documentId: string): Promise<boolean>;

  // Chunks
  saveChunks(chunks: readonly DocumentChunk[]): Promise<void>;
  getChunksByDocument(tenantId: string, documentId: string): Promise<readonly DocumentChunk[]>;
  getChunksByIds(tenantId: string, chunkIds: readonly string[]): Promise<readonly DocumentChunk[]>;
  deleteChunksByDocument(tenantId: string, documentId: string): Promise<number>;
  deleteChunksByCollection(tenantId: string, collectionId: string): Promise<number>;

  // Tenant Purge
  purgeTenantData(tenantId: string): Promise<{
    readonly collectionsDeleted: number;
    readonly documentsDeleted: number;
    readonly chunksDeleted: number;
  }>;

  // Health
  checkHealth(signal?: AbortSignal): Promise<boolean>;
}
