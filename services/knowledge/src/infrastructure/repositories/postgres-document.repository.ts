import type { DatabasePool } from '../database/connection.js';
import type { DocumentRepositoryPort } from '../../application/ports/document-repository.port.js';
import type {
  KnowledgeCollection,
  Document,
  DocumentChunk,
  DocumentStatus,
  DocumentErrorDetails,
} from '../../domain/index.js';

interface CollectionRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  embedding_model_id: string;
  embedding_dimensions: number;
  embedding_version: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface DocumentRow {
  id: string;
  tenant_id: string;
  collection_id: string;
  title: string;
  object_key: string;
  source_uri: string | null;
  mime_type: string;
  status: string;
  content_length_bytes: string | number;
  document_hash: string;
  total_chunks: number;
  total_tokens: number;
  error_phase: string | null;
  error_code: string | null;
  error_message: string | null;
  error_occurred_at: Date | null;
  metadata: Record<string, unknown> | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  indexed_at: Date | null;
  deleted_at: Date | null;
}

interface ChunkRow {
  id: string;
  tenant_id: string;
  collection_id: string;
  document_id: string;
  chunk_index: number;
  text: string;
  token_estimate: number;
  vector_id: string | null;
  embedding_model_id: string;
  embedding_dimensions: number;
  embedding_version: string;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export class PostgresDocumentRepository implements DocumentRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  // Collections
  public async createCollection(collection: KnowledgeCollection): Promise<void> {
    const query = `
      INSERT INTO oicunt_knowledge.knowledge_collections (
        id, tenant_id, name, description,
        embedding_model_id, embedding_dimensions, embedding_version,
        metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    await this.db.query(query, [
      collection.id,
      collection.tenantId,
      collection.name,
      collection.description ?? null,
      collection.embeddingConfig.modelId,
      collection.embeddingConfig.dimensions,
      collection.embeddingConfig.version,
      JSON.stringify(collection.metadata ?? {}),
      collection.createdAt,
      collection.updatedAt,
    ]);
  }

  public async getCollection(
    tenantId: string,
    collectionId: string,
  ): Promise<KnowledgeCollection | null> {
    const query = `
      SELECT * FROM oicunt_knowledge.knowledge_collections
      WHERE tenant_id = $1 AND id = $2
    `;
    const res = await this.db.query<CollectionRow>(query, [tenantId, collectionId]);
    const row = res.rows[0];
    return row ? this.mapCollectionRow(row) : null;
  }

  public async getCollectionByName(
    tenantId: string,
    name: string,
  ): Promise<KnowledgeCollection | null> {
    const query = `
      SELECT * FROM oicunt_knowledge.knowledge_collections
      WHERE tenant_id = $1 AND name = $2
    `;
    const res = await this.db.query<CollectionRow>(query, [tenantId, name]);
    const row = res.rows[0];
    return row ? this.mapCollectionRow(row) : null;
  }

  public async listCollections(tenantId: string): Promise<readonly KnowledgeCollection[]> {
    const query = `
      SELECT * FROM oicunt_knowledge.knowledge_collections
      WHERE tenant_id = $1
      ORDER BY created_at ASC
    `;
    const res = await this.db.query<CollectionRow>(query, [tenantId]);
    return res.rows.map((r) => this.mapCollectionRow(r));
  }

  public async deleteCollection(tenantId: string, collectionId: string): Promise<boolean> {
    const query = `
      DELETE FROM oicunt_knowledge.knowledge_collections
      WHERE tenant_id = $1 AND id = $2
    `;
    const res = await this.db.query(query, [tenantId, collectionId]);
    return (res.rowCount ?? 0) > 0;
  }

  // Documents
  public async createDocument(doc: Document): Promise<void> {
    const query = `
      INSERT INTO oicunt_knowledge.knowledge_documents (
        id, tenant_id, collection_id, title, object_key, source_uri,
        mime_type, status, content_length_bytes, document_hash,
        total_chunks, total_tokens, metadata, created_by,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;
    await this.db.query(query, [
      doc.id,
      doc.tenantId,
      doc.collectionId,
      doc.title,
      doc.objectKey,
      doc.sourceUri ?? null,
      doc.mimeType,
      doc.status,
      doc.contentLengthBytes,
      doc.documentHash,
      doc.totalChunks,
      doc.totalTokens,
      JSON.stringify(doc.metadata ?? {}),
      doc.createdBy,
      doc.createdAt,
      doc.updatedAt,
    ]);
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
    const query = `
      UPDATE oicunt_knowledge.knowledge_documents
      SET status = $1,
          error_phase = $2,
          error_code = $3,
          error_message = $4,
          error_occurred_at = $5,
          total_chunks = COALESCE($6, total_chunks),
          total_tokens = COALESCE($7, total_tokens),
          indexed_at = COALESCE($8, indexed_at),
          updated_at = NOW(),
          deleted_at = CASE WHEN $1 = 'deleted' THEN NOW() ELSE deleted_at END
      WHERE tenant_id = $9 AND id = $10 AND (status != 'deleted' OR $1 = 'deleted')
    `;
    await this.db.query(query, [
      status,
      error?.phase ?? null,
      error?.code ?? null,
      error?.message ?? null,
      error?.occurredAt ?? null,
      updates?.totalChunks ?? null,
      updates?.totalTokens ?? null,
      updates?.indexedAt ?? null,
      tenantId,
      documentId,
    ]);
  }

  public async getDocument(tenantId: string, documentId: string): Promise<Document | null> {
    const query = `
      SELECT * FROM oicunt_knowledge.knowledge_documents
      WHERE tenant_id = $1 AND id = $2
    `;
    const res = await this.db.query<DocumentRow>(query, [tenantId, documentId]);
    const row = res.rows[0];
    return row ? this.mapDocumentRow(row) : null;
  }

  public async getDocumentByHash(
    tenantId: string,
    collectionId: string,
    documentHash: string,
  ): Promise<Document | null> {
    const query = `
      SELECT * FROM oicunt_knowledge.knowledge_documents
      WHERE tenant_id = $1 AND collection_id = $2 AND document_hash = $3 AND status != 'deleted'
      LIMIT 1
    `;
    const res = await this.db.query<DocumentRow>(query, [tenantId, collectionId, documentHash]);
    const row = res.rows[0];
    return row ? this.mapDocumentRow(row) : null;
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
    const conditions = ['tenant_id = $1', 'collection_id = $2'];
    const params: unknown[] = [tenantId, collectionId];

    if (options?.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM oicunt_knowledge.knowledge_documents WHERE ${whereClause}`,
      params,
    );
    const totalCount = Number.parseInt(countRes.rows[0]?.count ?? '0', 10);

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;
    params.push(limit, offset);

    const selectQuery = `
      SELECT * FROM oicunt_knowledge.knowledge_documents
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const res = await this.db.query<DocumentRow>(selectQuery, params);

    return {
      documents: res.rows.map((r) => this.mapDocumentRow(r)),
      totalCount,
    };
  }

  public async markDocumentDeleted(tenantId: string, documentId: string): Promise<boolean> {
    const query = `
      UPDATE oicunt_knowledge.knowledge_documents
      SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2
    `;
    const res = await this.db.query(query, [tenantId, documentId]);
    return (res.rowCount ?? 0) > 0;
  }

  // Chunks
  public async saveChunks(chunks: readonly DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    await this.db.withTransaction(async (client) => {
      for (const chunk of chunks) {
        const query = `
          INSERT INTO oicunt_knowledge.knowledge_chunks (
            id, tenant_id, collection_id, document_id, chunk_index,
            text, token_estimate, vector_id,
            embedding_model_id, embedding_dimensions, embedding_version,
            metadata, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `;
        await client.query(query, [
          chunk.id,
          chunk.tenantId,
          chunk.collectionId,
          chunk.documentId,
          chunk.chunkIndex,
          chunk.text,
          chunk.tokenEstimate,
          chunk.vectorId ?? null,
          chunk.embeddingMetadata.modelId,
          chunk.embeddingMetadata.dimensions,
          chunk.embeddingMetadata.version,
          JSON.stringify(chunk.metadata ?? {}),
          chunk.createdAt,
        ]);
      }
    });
  }

  public async getChunksByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<readonly DocumentChunk[]> {
    const query = `
      SELECT * FROM oicunt_knowledge.knowledge_chunks
      WHERE tenant_id = $1 AND document_id = $2
      ORDER BY chunk_index ASC
    `;
    const res = await this.db.query<ChunkRow>(query, [tenantId, documentId]);
    return res.rows.map((r) => this.mapChunkRow(r));
  }

  public async getChunksByIds(
    tenantId: string,
    chunkIds: readonly string[],
  ): Promise<readonly DocumentChunk[]> {
    if (chunkIds.length === 0) return [];

    const query = `
      SELECT * FROM oicunt_knowledge.knowledge_chunks
      WHERE tenant_id = $1 AND id = ANY($2::text[])
    `;
    const res = await this.db.query<ChunkRow>(query, [tenantId, chunkIds as string[]]);
    return res.rows.map((r) => this.mapChunkRow(r));
  }

  public async deleteChunksByDocument(tenantId: string, documentId: string): Promise<number> {
    const query = `
      DELETE FROM oicunt_knowledge.knowledge_chunks
      WHERE tenant_id = $1 AND document_id = $2
    `;
    const res = await this.db.query(query, [tenantId, documentId]);
    return res.rowCount ?? 0;
  }

  public async deleteChunksByCollection(tenantId: string, collectionId: string): Promise<number> {
    const query = `
      DELETE FROM oicunt_knowledge.knowledge_chunks
      WHERE tenant_id = $1 AND collection_id = $2
    `;
    const res = await this.db.query(query, [tenantId, collectionId]);
    return res.rowCount ?? 0;
  }

  // Tenant Purge
  public async purgeTenantData(tenantId: string): Promise<{
    readonly collectionsDeleted: number;
    readonly documentsDeleted: number;
    readonly chunksDeleted: number;
  }> {
    return await this.db.withTransaction(async (client) => {
      const chunksRes = await client.query(
        'DELETE FROM oicunt_knowledge.knowledge_chunks WHERE tenant_id = $1',
        [tenantId],
      );
      const docsRes = await client.query(
        'DELETE FROM oicunt_knowledge.knowledge_documents WHERE tenant_id = $1',
        [tenantId],
      );
      const colsRes = await client.query(
        'DELETE FROM oicunt_knowledge.knowledge_collections WHERE tenant_id = $1',
        [tenantId],
      );

      return {
        collectionsDeleted: colsRes.rowCount ?? 0,
        documentsDeleted: docsRes.rowCount ?? 0,
        chunksDeleted: chunksRes.rowCount ?? 0,
      };
    });
  }

  public async checkHealth(signal?: AbortSignal): Promise<boolean> {
    return await this.db.ping(signal);
  }

  // Row Mappers
  private mapCollectionRow(row: CollectionRow): KnowledgeCollection {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
      description: row.description ?? undefined,
      embeddingConfig: {
        modelId: row.embedding_model_id,
        dimensions: row.embedding_dimensions,
        version: row.embedding_version,
      },
      metadata: row.metadata ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private mapDocumentRow(row: DocumentRow): Document {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      collectionId: row.collection_id,
      title: row.title,
      objectKey: row.object_key,
      sourceUri: row.source_uri ?? undefined,
      mimeType: row.mime_type,
      status: row.status as DocumentStatus,
      contentLengthBytes: Number(row.content_length_bytes),
      documentHash: row.document_hash,
      totalChunks: row.total_chunks,
      totalTokens: row.total_tokens,
      error:
        row.error_phase && row.error_code && row.error_message
          ? {
              phase: row.error_phase as DocumentErrorDetails['phase'],
              code: row.error_code,
              message: row.error_message,
              occurredAt: row.error_occurred_at
                ? row.error_occurred_at.toISOString()
                : new Date().toISOString(),
            }
          : undefined,
      metadata: row.metadata ?? {},
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      indexedAt: row.indexed_at ? row.indexed_at.toISOString() : undefined,
      deletedAt: row.deleted_at ? row.deleted_at.toISOString() : undefined,
    };
  }

  private mapChunkRow(row: ChunkRow): DocumentChunk {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      collectionId: row.collection_id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      text: row.text,
      tokenEstimate: row.token_estimate,
      vectorId: row.vector_id ?? undefined,
      embeddingMetadata: {
        modelId: row.embedding_model_id,
        dimensions: row.embedding_dimensions,
        version: row.embedding_version,
      },
      metadata: row.metadata ?? {},
      createdAt: row.created_at.toISOString(),
    };
  }
}
