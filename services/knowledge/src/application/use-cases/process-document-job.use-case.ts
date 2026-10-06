import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { ObjectStoragePort } from '../ports/object-storage.port.js';
import type { TextExtractorPort } from '../ports/text-extractor.port.js';
import type { EmbeddingServicePort } from '../ports/embedding-service.port.js';
import type { VectorStorePort, VectorUpsertItem } from '../ports/vector-store.port.js';
import type { DocumentProcessJob } from '../ports/document-processing-queue.port.js';
import type { DocumentChunk } from '../../domain/index.js';
import { chunkText } from '../../domain/index.js';

export class ProcessDocumentJobUseCase {
  constructor(
    private readonly repository: DocumentRepositoryPort,
    private readonly objectStorage: ObjectStoragePort,
    private readonly textExtractor: TextExtractorPort,
    private readonly embeddingService: EmbeddingServicePort,
    private readonly vectorStore: VectorStorePort,
  ) {}

  public async execute(job: DocumentProcessJob): Promise<void> {
    const doc = await this.repository.getDocument(job.tenantId, job.documentId);
    if (!doc || doc.status === 'deleted') {
      return;
    }

    // Transition to processing
    await this.repository.updateDocumentStatus(job.tenantId, job.documentId, 'processing');

    const collection = await this.repository.getCollection(job.tenantId, job.collectionId);
    if (!collection) {
      await this.repository.updateDocumentStatus(job.tenantId, job.documentId, 'failed', {
        phase: 'extraction',
        code: 'COLLECTION_NOT_FOUND',
        message: `Collection '${job.collectionId}' not found during processing`,
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    // Phase 1 & 2: Extraction
    let extractedText: string;
    try {
      const stream = await this.objectStorage.getObjectStream(job.objectKey);
      extractedText = await this.textExtractor.extractText(stream, job.mimeType);
      if (!extractedText || extractedText.trim().length === 0) {
        throw new Error('Document produced empty text content during extraction');
      }
    } catch (err) {
      const currentDoc = await this.repository.getDocument(job.tenantId, job.documentId);
      if (!currentDoc || currentDoc.status === 'deleted') {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.repository.updateDocumentStatus(job.tenantId, job.documentId, 'failed', {
        phase: 'extraction',
        code: 'EXTRACTION_FAILED',
        message,
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    // Check if deleted concurrently
    const currentDocPhase2 = await this.repository.getDocument(job.tenantId, job.documentId);
    if (!currentDocPhase2 || currentDocPhase2.status === 'deleted') {
      return;
    }

    // Phase 3: Chunking
    let chunks: readonly DocumentChunk[];
    try {
      chunks = chunkText(doc, extractedText, collection.embeddingConfig);
      if (chunks.length === 0) {
        throw new Error('Chunking produced zero chunks');
      }
    } catch (err) {
      const currentDoc = await this.repository.getDocument(job.tenantId, job.documentId);
      if (!currentDoc || currentDoc.status === 'deleted') {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.repository.updateDocumentStatus(job.tenantId, job.documentId, 'failed', {
        phase: 'chunking',
        code: 'CHUNKING_FAILED',
        message,
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    // Check if deleted concurrently
    const currentDocPhase3 = await this.repository.getDocument(job.tenantId, job.documentId);
    if (!currentDocPhase3 || currentDocPhase3.status === 'deleted') {
      return;
    }

    // Phase 4: Embeddings (via dedicated EmbeddingServicePort)
    let embeddings: readonly (readonly number[])[];
    try {
      const embeddingResponse = await this.embeddingService.generateEmbeddings({
        texts: chunks.map((c) => c.text),
        modelId: collection.embeddingConfig.modelId,
        dimensions: collection.embeddingConfig.dimensions,
        tenantId: job.tenantId,
        correlationId: job.correlationId,
      });
      embeddings = embeddingResponse.embeddings;
      if (embeddings.length !== chunks.length) {
        throw new Error(
          `Embedding service returned ${embeddings.length} embeddings for ${chunks.length} chunks`,
        );
      }
    } catch (err) {
      const currentDoc = await this.repository.getDocument(job.tenantId, job.documentId);
      if (!currentDoc || currentDoc.status === 'deleted') {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.repository.updateDocumentStatus(job.tenantId, job.documentId, 'failed', {
        phase: 'embedding',
        code: 'EMBEDDING_UNAVAILABLE',
        message,
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    // Check if deleted concurrently
    const currentDocPhase4 = await this.repository.getDocument(job.tenantId, job.documentId);
    if (!currentDocPhase4 || currentDocPhase4.status === 'deleted') {
      return;
    }

    // Phase 5: Vector Indexing & Chunk Persistence
    try {
      // Reconcile/clear any partial state from prior attempts before writing (retry idempotency)
      await this.vectorStore.deleteVectorsByDocument(job.tenantId, job.documentId);
      await this.repository.deleteChunksByDocument(job.tenantId, job.documentId);

      // Verify not deleted immediately prior to writing vectors/chunks
      const preWriteDoc = await this.repository.getDocument(job.tenantId, job.documentId);
      if (!preWriteDoc || preWriteDoc.status === 'deleted') {
        return;
      }

      const vectorItems: VectorUpsertItem[] = chunks.map((chunk, i) => ({
        id: chunk.id,
        tenantId: chunk.tenantId,
        collectionId: chunk.collectionId,
        documentId: chunk.documentId,
        vector: embeddings[i]!,
        payload: {
          chunkIndex: chunk.chunkIndex,
          tokenEstimate: chunk.tokenEstimate,
          documentTitle: doc.title,
          sourceUri: doc.sourceUri,
          ...chunk.metadata,
        },
      }));

      await this.vectorStore.upsertVectors(vectorItems);
      await this.repository.saveChunks(chunks);
    } catch (err) {
      // Compensating rollback: delete any written vectors and chunks
      try {
        await this.vectorStore.deleteVectorsByDocument(job.tenantId, job.documentId);
      } catch {
        // Ignore rollback error
      }
      try {
        await this.repository.deleteChunksByDocument(job.tenantId, job.documentId);
      } catch {
        // Ignore rollback error
      }

      const currentDoc = await this.repository.getDocument(job.tenantId, job.documentId);
      if (!currentDoc || currentDoc.status === 'deleted') {
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      await this.repository.updateDocumentStatus(job.tenantId, job.documentId, 'failed', {
        phase: 'indexing',
        code: 'VECTOR_STORE_UNAVAILABLE',
        message,
        occurredAt: new Date().toISOString(),
      });
      return;
    }

    // Check if deleted concurrently before Phase 6 mark ready
    const preReadyDoc = await this.repository.getDocument(job.tenantId, job.documentId);
    if (!preReadyDoc || preReadyDoc.status === 'deleted') {
      try {
        await this.vectorStore.deleteVectorsByDocument(job.tenantId, job.documentId);
      } catch {
        // Ignore compensating cleanup error
      }
      try {
        await this.repository.deleteChunksByDocument(job.tenantId, job.documentId);
      } catch {
        // Ignore compensating cleanup error
      }
      return;
    }

    // Phase 6: Mark Ready
    const totalTokens = chunks.reduce((acc, c) => acc + c.tokenEstimate, 0);
    await this.repository.updateDocumentStatus(job.tenantId, job.documentId, 'ready', undefined, {
      totalChunks: chunks.length,
      totalTokens,
      indexedAt: new Date().toISOString(),
    });
  }
}
