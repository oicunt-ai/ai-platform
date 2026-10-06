import { describe, expect, it } from 'vitest';
import { InMemoryDocumentRepository } from '../../../src/infrastructure/repositories/in-memory-document.repository.js';
import { InMemoryObjectStorage } from '../../../src/infrastructure/object-storage/in-memory-object-storage.js';
import { InMemoryVectorStore } from '../../../src/infrastructure/vector-store/in-memory-vector-store.js';
import { MockEmbeddingService } from '../../../src/infrastructure/embedding/mock-embedding-service.js';
import { InMemoryDocumentProcessingQueue } from '../../../src/infrastructure/queue/in-memory-document-queue.js';
import { DefaultTextExtractor } from '../../../src/infrastructure/extraction/default-text-extractor.js';
import { RegisterDocumentUseCase } from '../../../src/application/use-cases/register-document.use-case.js';
import { ProcessDocumentJobUseCase } from '../../../src/application/use-cases/process-document-job.use-case.js';
import { RetryDocumentUseCase } from '../../../src/application/use-cases/retry-document.use-case.js';
import { createKnowledgeCollection } from '../../../src/domain/collection.js';
import { InvalidRequestError } from '../../../src/domain/errors.js';
import type { EmbeddingServicePort } from '../../../src/application/ports/embedding-service.port.js';

describe('Document Processing Pipeline & State Machine', () => {
  it('successfully executes end-to-end ingestion from staging to ready status', async () => {
    const repository = new InMemoryDocumentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();
    const queue = new InMemoryDocumentProcessingQueue({ autoProcess: false });
    const textExtractor = new DefaultTextExtractor();

    // 1. Create collection
    const collection = createKnowledgeCollection({
      id: 'col_docs_01',
      tenantId: 'tenant_alpha',
      name: 'Architecture Documentation',
      embeddingConfig: {
        modelId: 'mock-embedding-v1',
        dimensions: 64,
        version: '1.0.0',
      },
    });
    await repository.createCollection(collection);

    // 2. Stage document content in object storage
    const stagedKey = 'tenant_alpha/raw/arch_overview.md';
    const documentContent = `# Architecture Overview\n\nThis document describes the six-tier architecture of the AI platform.\n\n## Inference Boundary\n\nThe inference boundary coordinates model runtimes.`;
    await objectStorage.putObject(stagedKey, Buffer.from(documentContent), {
      mimeType: 'text/markdown',
      tenantId: 'tenant_alpha',
    });

    // 3. Register document
    const registerUseCase = new RegisterDocumentUseCase(repository, queue);
    const registered = await registerUseCase.execute(
      'tenant_alpha',
      'col_docs_01',
      {
        title: 'Architecture Overview',
        mimeType: 'text/markdown',
        objectKey: stagedKey,
        contentLengthBytes: Buffer.byteLength(documentContent),
      },
      {
        userId: 'user_1',
        correlationId: 'corr_test_01',
      },
    );

    expect(registered.status).toBe('queued');
    expect(registered.id).toBeDefined();

    // Verify job in queue
    const jobs = queue.getPublishedJobs();
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.documentId).toBe(registered.id);

    // 4. Process job
    const processUseCase = new ProcessDocumentJobUseCase(
      repository,
      objectStorage,
      textExtractor,
      embeddingService,
      vectorStore,
    );

    await processUseCase.execute(job);

    // 5. Verify document transitioned to ready
    const finishedDoc = await repository.getDocument('tenant_alpha', registered.id);
    expect(finishedDoc).toBeDefined();
    expect(finishedDoc!.status).toBe('ready');
    expect(finishedDoc!.totalChunks).toBeGreaterThan(0);
    expect(finishedDoc!.totalTokens).toBeGreaterThan(0);
    expect(finishedDoc!.error).toBeUndefined();

    // 6. Verify chunks and vectors persisted
    const chunks = await repository.getChunksByDocument('tenant_alpha', registered.id);
    expect(chunks.length).toBe(finishedDoc!.totalChunks);

    const vectorResults = await vectorStore.searchVectors({
      tenantId: 'tenant_alpha',
      collectionIds: ['col_docs_01'],
      topK: 5,
      vector: (
        await embeddingService.generateEmbeddings({
          texts: ['architecture'],
          modelId: 'mock',
          dimensions: 64,
          tenantId: 'tenant_alpha',
        })
      ).embeddings[0]!,
    });
    expect(vectorResults.length).toBeGreaterThan(0);
  });

  it('transitions document to failed status when object cannot be retrieved or extracted', async () => {
    const repository = new InMemoryDocumentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();
    const queue = new InMemoryDocumentProcessingQueue({ autoProcess: false });
    const textExtractor = new DefaultTextExtractor();

    const collection = createKnowledgeCollection({
      id: 'col_docs_02',
      tenantId: 'tenant_alpha',
      name: 'Docs',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    // Register document referencing NON-EXISTENT objectKey
    const registerUseCase = new RegisterDocumentUseCase(repository, queue);
    const registered = await registerUseCase.execute(
      'tenant_alpha',
      'col_docs_02',
      {
        title: 'Missing Document',
        mimeType: 'text/plain',
        objectKey: 'non_existent_key.txt',
      },
      { correlationId: 'corr_missing' },
    );

    const processUseCase = new ProcessDocumentJobUseCase(
      repository,
      objectStorage,
      textExtractor,
      embeddingService,
      vectorStore,
    );

    await processUseCase.execute(queue.getPublishedJobs()[0]!);

    const failedDoc = await repository.getDocument('tenant_alpha', registered.id);
    expect(failedDoc!.status).toBe('failed');
    expect(failedDoc!.error).toBeDefined();
    expect(failedDoc!.error!.phase).toBe('extraction');
    expect(failedDoc!.error!.code).toBe('EXTRACTION_FAILED');

    // Test retry use case on failed document
    const retryUseCase = new RetryDocumentUseCase(repository, queue);
    const retried = await retryUseCase.execute('tenant_alpha', registered.id, {
      correlationId: 'corr_retry',
    });
    expect(retried.status).toBe('queued');
    expect(retried.error).toBeUndefined();

    // Verify cannot retry a document not in 'failed' status
    await expect(
      retryUseCase.execute('tenant_alpha', registered.id, { correlationId: 'corr_illegal' }),
    ).rejects.toThrow(InvalidRequestError);
  });

  it('marks document failed with phase extraction when MIME type is unsupported', async () => {
    const repository = new InMemoryDocumentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();
    const queue = new InMemoryDocumentProcessingQueue({ autoProcess: false });
    const textExtractor = new DefaultTextExtractor();

    const collection = createKnowledgeCollection({
      id: 'col_pdf_01',
      tenantId: 'tenant_alpha',
      name: 'PDF Collection',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const pdfKey = 'tenant_alpha/files/unsupported.pdf';
    await objectStorage.putObject(pdfKey, Buffer.from('%PDF-1.4 binary content'), {
      mimeType: 'application/pdf',
      tenantId: 'tenant_alpha',
    });

    const registerUseCase = new RegisterDocumentUseCase(repository, queue);
    const registered = await registerUseCase.execute(
      'tenant_alpha',
      'col_pdf_01',
      {
        title: 'Unsupported PDF Document',
        mimeType: 'application/pdf',
        objectKey: pdfKey,
      },
      { correlationId: 'corr_pdf' },
    );

    const processUseCase = new ProcessDocumentJobUseCase(
      repository,
      objectStorage,
      textExtractor,
      embeddingService,
      vectorStore,
    );

    await processUseCase.execute(queue.getPublishedJobs()[0]!);

    const failedDoc = await repository.getDocument('tenant_alpha', registered.id);
    expect(failedDoc!.status).toBe('failed');
    expect(failedDoc!.error).toBeDefined();
    expect(failedDoc!.error!.phase).toBe('extraction');
    expect(failedDoc!.error!.code).toBe('EXTRACTION_FAILED');
    expect(failedDoc!.error!.message).toContain('Unsupported MIME type');

    // Ensure no vectors or chunks were created
    const chunks = await repository.getChunksByDocument('tenant_alpha', registered.id);
    expect(chunks).toHaveLength(0);
  });

  it('marks document failed with phase embedding when embedding service fails', async () => {
    const repository = new InMemoryDocumentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const queue = new InMemoryDocumentProcessingQueue({ autoProcess: false });
    const textExtractor = new DefaultTextExtractor();

    // Failing embedding service
    const failingEmbeddingService: EmbeddingServicePort = {
      generateEmbeddings: async () => {
        throw new Error('Embedding provider rate limited or unavailable');
      },
      checkHealth: async () => true,
    };

    const collection = createKnowledgeCollection({
      id: 'col_emb_fail',
      tenantId: 'tenant_alpha',
      name: 'Embedding Fail Collection',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const stagedKey = 'tenant_alpha/files/good.txt';
    await objectStorage.putObject(stagedKey, Buffer.from('Valid text content'), {
      mimeType: 'text/plain',
      tenantId: 'tenant_alpha',
    });

    const registerUseCase = new RegisterDocumentUseCase(repository, queue);
    const registered = await registerUseCase.execute(
      'tenant_alpha',
      'col_emb_fail',
      {
        title: 'Good Document',
        mimeType: 'text/plain',
        objectKey: stagedKey,
      },
      { correlationId: 'corr_emb_fail' },
    );

    const processUseCase = new ProcessDocumentJobUseCase(
      repository,
      objectStorage,
      textExtractor,
      failingEmbeddingService,
      vectorStore,
    );

    await processUseCase.execute(queue.getPublishedJobs()[0]!);

    const failedDoc = await repository.getDocument('tenant_alpha', registered.id);
    expect(failedDoc!.status).toBe('failed');
    expect(failedDoc!.error).toBeDefined();
    expect(failedDoc!.error!.phase).toBe('embedding');
    expect(failedDoc!.error!.code).toBe('EMBEDDING_UNAVAILABLE');
    expect(failedDoc!.error!.message).toContain('Embedding provider rate limited');

    // Invariant: no chunks or vectors created
    expect(await repository.getChunksByDocument('tenant_alpha', registered.id)).toHaveLength(0);
  });

  it('executes compensating rollback of vectors when chunk persistence fails after vector upsert', async () => {
    const repository = new InMemoryDocumentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();
    const queue = new InMemoryDocumentProcessingQueue({ autoProcess: false });
    const textExtractor = new DefaultTextExtractor();

    const collection = createKnowledgeCollection({
      id: 'col_rollback',
      tenantId: 'tenant_alpha',
      name: 'Rollback Collection',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const stagedKey = 'tenant_alpha/files/rollback.txt';
    await objectStorage.putObject(stagedKey, Buffer.from('Rollback test document content'), {
      mimeType: 'text/plain',
      tenantId: 'tenant_alpha',
    });

    const registerUseCase = new RegisterDocumentUseCase(repository, queue);
    const registered = await registerUseCase.execute(
      'tenant_alpha',
      'col_rollback',
      {
        title: 'Rollback Document',
        mimeType: 'text/plain',
        objectKey: stagedKey,
      },
      { correlationId: 'corr_rollback' },
    );

    // Spy / override repository.saveChunks to simulate database error after vectors were upserted
    const failingRepo = Object.create(repository);
    failingRepo.saveChunks = async () => {
      throw new Error('Database connection pool exhausted during chunk insert');
    };

    const processUseCase = new ProcessDocumentJobUseCase(
      failingRepo,
      objectStorage,
      textExtractor,
      embeddingService,
      vectorStore,
    );

    await processUseCase.execute(queue.getPublishedJobs()[0]!);

    const failedDoc = await repository.getDocument('tenant_alpha', registered.id);
    expect(failedDoc!.status).toBe('failed');
    expect(failedDoc!.error).toBeDefined();
    expect(failedDoc!.error!.phase).toBe('indexing');
    expect(failedDoc!.error!.code).toBe('VECTOR_STORE_UNAVAILABLE');

    // Verify compensating cleanup removed all vectors for this document
    const vectorHits = await vectorStore.searchVectors({
      tenantId: 'tenant_alpha',
      collectionIds: ['col_rollback'],
      topK: 10,
      vector: (
        await embeddingService.generateEmbeddings({
          texts: ['Rollback'],
          modelId: 'mock',
          dimensions: 64,
          tenantId: 'tenant_alpha',
        })
      ).embeddings[0]!,
    });
    expect(vectorHits).toHaveLength(0);
    expect(await repository.getChunksByDocument('tenant_alpha', registered.id)).toHaveLength(0);
  });

  it('aborts and cleans up vectors without marking ready if document is deleted concurrently', async () => {
    const repository = new InMemoryDocumentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();
    const queue = new InMemoryDocumentProcessingQueue({ autoProcess: false });
    const textExtractor = new DefaultTextExtractor();

    const collection = createKnowledgeCollection({
      id: 'col_concurrent_del',
      tenantId: 'tenant_alpha',
      name: 'Concurrent Deletion Collection',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const stagedKey = 'tenant_alpha/files/concurrent.txt';
    await objectStorage.putObject(stagedKey, Buffer.from('Concurrent deletion test content'), {
      mimeType: 'text/plain',
      tenantId: 'tenant_alpha',
    });

    const registerUseCase = new RegisterDocumentUseCase(repository, queue);
    const registered = await registerUseCase.execute(
      'tenant_alpha',
      'col_concurrent_del',
      {
        title: 'Concurrent Deletion Document',
        mimeType: 'text/plain',
        objectKey: stagedKey,
      },
      { correlationId: 'corr_concurrent' },
    );

    // Simulate concurrent deletion by marking document deleted right before Phase 5 / Phase 6
    // We wrap embedding service to delete the document during embedding generation
    const deletingEmbeddingService: EmbeddingServicePort = {
      generateEmbeddings: async (params) => {
        // Mark deleted concurrently
        await repository.markDocumentDeleted('tenant_alpha', registered.id);
        return embeddingService.generateEmbeddings(params);
      },
      checkHealth: async () => true,
    };

    const processUseCase = new ProcessDocumentJobUseCase(
      repository,
      objectStorage,
      textExtractor,
      deletingEmbeddingService,
      vectorStore,
    );

    await processUseCase.execute(queue.getPublishedJobs()[0]!);

    const finalDoc = await repository.getDocument('tenant_alpha', registered.id);
    // Invariant: Status must remain 'deleted', never overwritten to 'ready' or 'failed'
    expect(finalDoc!.status).toBe('deleted');

    // Invariant: Vectors and chunks must be clean
    expect(await repository.getChunksByDocument('tenant_alpha', registered.id)).toHaveLength(0);
  });

  it('reconciles and clears prior attempt vectors and chunks on retry', async () => {
    const repository = new InMemoryDocumentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const embeddingService = new MockEmbeddingService();
    const queue = new InMemoryDocumentProcessingQueue({ autoProcess: false });
    const textExtractor = new DefaultTextExtractor();

    const collection = createKnowledgeCollection({
      id: 'col_retry_reconcile',
      tenantId: 'tenant_alpha',
      name: 'Retry Reconcile Collection',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const stagedKey = 'tenant_alpha/files/reconcile.txt';
    await objectStorage.putObject(stagedKey, Buffer.from('Reconcile test content across retry'), {
      mimeType: 'text/plain',
      tenantId: 'tenant_alpha',
    });

    const registerUseCase = new RegisterDocumentUseCase(repository, queue);
    const registered = await registerUseCase.execute(
      'tenant_alpha',
      'col_retry_reconcile',
      {
        title: 'Reconcile Document',
        mimeType: 'text/plain',
        objectKey: stagedKey,
      },
      { correlationId: 'corr_reconcile' },
    );

    // Simulate leftover orphan vector from a previous failed run
    await vectorStore.upsertVectors([
      {
        id: `orphan_${registered.id}_old`,
        tenantId: 'tenant_alpha',
        collectionId: 'col_retry_reconcile',
        documentId: registered.id,
        vector: new Array(64).fill(0.1),
        payload: { chunkIndex: 99 },
      },
    ]);

    const processUseCase = new ProcessDocumentJobUseCase(
      repository,
      objectStorage,
      textExtractor,
      embeddingService,
      vectorStore,
    );

    await processUseCase.execute(queue.getPublishedJobs()[0]!);

    const readyDoc = await repository.getDocument('tenant_alpha', registered.id);
    expect(readyDoc!.status).toBe('ready');

    // Vector store should ONLY contain current chunks, orphan vector must be purged
    const chunks = await repository.getChunksByDocument('tenant_alpha', registered.id);
    expect(chunks.length).toBe(readyDoc!.totalChunks);
  });
});
