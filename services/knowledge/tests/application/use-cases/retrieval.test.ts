import { describe, expect, it } from 'vitest';
import { InMemoryDocumentRepository } from '../../../src/infrastructure/repositories/in-memory-document.repository.js';
import { InMemoryVectorStore } from '../../../src/infrastructure/vector-store/in-memory-vector-store.js';
import { MockEmbeddingService } from '../../../src/infrastructure/embedding/mock-embedding-service.js';
import { RetrieveContextUseCase } from '../../../src/application/use-cases/retrieve-context.use-case.js';
import { createKnowledgeCollection } from '../../../src/domain/collection.js';
import { createDocument } from '../../../src/domain/document.js';
import { createDocumentChunk } from '../../../src/domain/chunk.js';
import { CollectionNotFoundError, InvalidRequestError } from '../../../src/domain/errors.js';

describe('RetrieveContextUseCase - Retrieval & Invariants', () => {
  it('retrieves chunks with accurate scores and provenance for ready documents', async () => {
    const repository = new InMemoryDocumentRepository();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();

    // 1. Setup collection and document
    const collection = createKnowledgeCollection({
      id: 'col_rag_01',
      tenantId: 'tenant_alpha',
      name: 'Legal Policies',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const document = createDocument({
      id: 'doc_rag_01',
      tenantId: 'tenant_alpha',
      collectionId: 'col_rag_01',
      title: 'Data Privacy Agreement',
      objectKey: 'tenant_alpha/dpa.pdf',
      sourceUri: 's3://oicunt-knowledge/tenant_alpha/dpa.pdf',
      mimeType: 'application/pdf',
      contentLengthBytes: 5000,
      documentHash: 'hash_dpa_01',
    });
    await repository.createDocument(document);
    // Mark READY
    await repository.updateDocumentStatus('tenant_alpha', 'doc_rag_01', 'ready');

    // 2. Add chunks and vectors
    const chunk1 = createDocumentChunk({
      id: 'chk_1',
      tenantId: 'tenant_alpha',
      documentId: 'doc_rag_01',
      collectionId: 'col_rag_01',
      chunkIndex: 0,
      text: 'Customer data is encrypted at rest using AES-256 and strictly isolated per tenant.',
      tokenEstimate: 16,
      embeddingMetadata: { modelId: 'mock', dimensions: 64, version: '1.0' },
      metadata: { section: 'Encryption Standards', pageNumber: 2 },
    });
    await repository.saveChunks([chunk1]);

    const embResult = await embeddingService.generateEmbeddings({
      texts: [chunk1.text],
      modelId: 'mock',
      dimensions: 64,
      tenantId: 'tenant_alpha',
    });
    await vectorStore.upsertVectors([
      {
        id: chunk1.id,
        documentId: chunk1.documentId,
        collectionId: chunk1.collectionId,
        tenantId: chunk1.tenantId,
        vector: embResult.embeddings[0]!,
        payload: {},
      },
    ]);

    // 3. Execute retrieval
    const useCase = new RetrieveContextUseCase(repository, vectorStore, embeddingService);
    const response = await useCase.execute(
      { tenantId: 'tenant_alpha', correlationId: 'corr_retrieval' },
      {
        query: 'What encryption standard is used for customer data?',
        collectionIds: ['col_rag_01'],
        topK: 3,
      },
    );

    expect(response.query).toBe('What encryption standard is used for customer data?');
    expect(response.chunks).toHaveLength(1);
    const retrieved = response.chunks[0]!;
    expect(retrieved.id).toBe('chk_1');
    expect(retrieved.text).toContain('AES-256');
    expect(typeof retrieved.score).toBe('number');
    expect(Number.isFinite(retrieved.score)).toBe(true);
    expect(retrieved.provenance.documentId).toBe('doc_rag_01');
    expect(retrieved.provenance.collectionId).toBe('col_rag_01');
    expect(retrieved.provenance.documentTitle).toBe('Data Privacy Agreement');
    expect(retrieved.provenance.sourceUri).toBe('s3://oicunt-knowledge/tenant_alpha/dpa.pdf');
    expect(retrieved.provenance.metadata).toEqual({
      section: 'Encryption Standards',
      pageNumber: 2,
    });
  });

  it('CRITICAL INVARIANT: NEVER retrieves chunks from documents that are not in ready status', async () => {
    const repository = new InMemoryDocumentRepository();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();

    const collection = createKnowledgeCollection({
      id: 'col_invariant',
      tenantId: 'tenant_alpha',
      name: 'Status Tests',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const statuses = ['created', 'queued', 'processing', 'failed', 'deleted'] as const;

    for (let i = 0; i < statuses.length; i++) {
      const status = statuses[i]!;
      const docId = `doc_status_${status}`;
      const chkId = `chk_status_${status}`;

      const doc = createDocument({
        id: docId,
        tenantId: 'tenant_alpha',
        collectionId: 'col_invariant',
        title: `Doc in status ${status}`,
        objectKey: `k_${status}`,
        mimeType: 'text/plain',
        contentLengthBytes: 100,
        documentHash: `hash_${status}`,
      });
      await repository.createDocument(doc);
      if (status !== 'created') {
        await repository.updateDocumentStatus('tenant_alpha', docId, status);
      }

      const chunk = createDocumentChunk({
        id: chkId,
        tenantId: 'tenant_alpha',
        documentId: docId,
        collectionId: 'col_invariant',
        chunkIndex: 0,
        text: `Content for status ${status}`,
        tokenEstimate: 10,
        embeddingMetadata: { modelId: 'mock', dimensions: 64, version: '1.0' },
      });
      await repository.saveChunks([chunk]);

      const emb = await embeddingService.generateEmbeddings({
        texts: [chunk.text],
        modelId: 'mock',
        dimensions: 64,
        tenantId: 'tenant_alpha',
      });
      await vectorStore.upsertVectors([
        {
          id: chunk.id,
          documentId: docId,
          collectionId: 'col_invariant',
          tenantId: 'tenant_alpha',
          vector: emb.embeddings[0]!,
          payload: {},
        },
      ]);
    }

    // Now query the vector store
    const useCase = new RetrieveContextUseCase(repository, vectorStore, embeddingService);
    const response = await useCase.execute(
      { tenantId: 'tenant_alpha' },
      {
        query: 'Content for status',
        collectionIds: ['col_invariant'],
        topK: 10,
      },
    );

    // None of the non-ready documents should be retrieved!
    expect(response.chunks).toHaveLength(0);
  });

  it('enforces collection tenant ownership and rejects unauthorized access', async () => {
    const repository = new InMemoryDocumentRepository();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();

    // Collection belongs to tenant_beta
    const collection = createKnowledgeCollection({
      id: 'col_beta_only',
      tenantId: 'tenant_beta',
      name: 'Beta Secret Docs',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const useCase = new RetrieveContextUseCase(repository, vectorStore, embeddingService);

    // Request from tenant_alpha targeting tenant_beta's collection
    await expect(
      useCase.execute(
        { tenantId: 'tenant_alpha' },
        { query: 'test', collectionIds: ['col_beta_only'] },
      ),
    ).rejects.toThrow(CollectionNotFoundError);
  });

  it('validates topK bounds (1 to 50)', async () => {
    const repository = new InMemoryDocumentRepository();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();

    const collection = createKnowledgeCollection({
      id: 'col_bounds',
      tenantId: 'tenant_alpha',
      name: 'Bounds',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const useCase = new RetrieveContextUseCase(repository, vectorStore, embeddingService);

    await expect(
      useCase.execute(
        { tenantId: 'tenant_alpha' },
        { query: 'test', collectionIds: ['col_bounds'], topK: 0 },
      ),
    ).rejects.toThrow(InvalidRequestError);

    await expect(
      useCase.execute(
        { tenantId: 'tenant_alpha' },
        { query: 'test', collectionIds: ['col_bounds'], topK: 51 },
      ),
    ).rejects.toThrow(InvalidRequestError);
  });
});
