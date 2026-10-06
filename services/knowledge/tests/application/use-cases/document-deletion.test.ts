import { describe, expect, it } from 'vitest';
import { InMemoryDocumentRepository } from '../../../src/infrastructure/repositories/in-memory-document.repository.js';
import { InMemoryVectorStore } from '../../../src/infrastructure/vector-store/in-memory-vector-store.js';
import { InMemoryObjectStorage } from '../../../src/infrastructure/object-storage/in-memory-object-storage.js';
import { MockEmbeddingService } from '../../../src/infrastructure/embedding/mock-embedding-service.js';
import { DeleteDocumentUseCase } from '../../../src/application/use-cases/delete-document.use-case.js';
import { RetrieveContextUseCase } from '../../../src/application/use-cases/retrieve-context.use-case.js';
import { createKnowledgeCollection } from '../../../src/domain/collection.js';
import { createDocument } from '../../../src/domain/document.js';
import { createDocumentChunk } from '../../../src/domain/chunk.js';

describe('DeleteDocumentUseCase - Immediate Retrieval Exclusion & Cascade', () => {
  it('immediately excludes document from retrieval upon deletion and cleans up assets', async () => {
    const repository = new InMemoryDocumentRepository();
    const vectorStore = new InMemoryVectorStore();
    const objectStorage = new InMemoryObjectStorage();
    const embeddingService = new MockEmbeddingService();

    // 1. Setup collection and document
    const collection = createKnowledgeCollection({
      id: 'col_del_01',
      tenantId: 'tenant_alpha',
      name: 'Deletion Tests',
      embeddingConfig: { modelId: 'mock', dimensions: 64, version: '1.0' },
    });
    await repository.createCollection(collection);

    const docKey = 'tenant_alpha/files/doc1.txt';
    await objectStorage.putObject(docKey, Buffer.from('sample secret content'), {
      mimeType: 'text/plain',
      tenantId: 'tenant_alpha',
    });

    const document = createDocument({
      id: 'doc_to_delete',
      tenantId: 'tenant_alpha',
      collectionId: 'col_del_01',
      title: 'Secret Document',
      objectKey: docKey,
      mimeType: 'text/plain',
      contentLengthBytes: 50,
      documentHash: 'hash_del_01',
    });
    await repository.createDocument(document);
    await repository.updateDocumentStatus('tenant_alpha', 'doc_to_delete', 'ready');

    const chunk = createDocumentChunk({
      id: 'chk_to_delete',
      tenantId: 'tenant_alpha',
      documentId: 'doc_to_delete',
      collectionId: 'col_del_01',
      chunkIndex: 0,
      text: 'sample secret content',
      tokenEstimate: 5,
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
        documentId: 'doc_to_delete',
        collectionId: 'col_del_01',
        tenantId: 'tenant_alpha',
        vector: emb.embeddings[0]!,
        payload: {},
      },
    ]);

    // 2. Verify it is initially retrievable
    const retrieveUseCase = new RetrieveContextUseCase(repository, vectorStore, embeddingService);
    const beforeResult = await retrieveUseCase.execute(
      { tenantId: 'tenant_alpha' },
      { query: 'sample secret content', collectionIds: ['col_del_01'] },
    );
    expect(beforeResult.chunks).toHaveLength(1);

    // 3. Delete document
    const deleteUseCase = new DeleteDocumentUseCase(repository, vectorStore, objectStorage);
    const delResult = await deleteUseCase.execute('tenant_alpha', 'doc_to_delete');

    expect(delResult.documentId).toBe('doc_to_delete');
    expect(delResult.status).toBe('deleted');
    expect(delResult.deletedAt).toBeDefined();

    // 4. CRITICAL INVARIANT: Retrieval immediately returns 0 chunks
    const afterResult = await retrieveUseCase.execute(
      { tenantId: 'tenant_alpha' },
      { query: 'sample secret content', collectionIds: ['col_del_01'] },
    );
    expect(afterResult.chunks).toHaveLength(0);

    // 5. Verify physical cleanups
    expect(await objectStorage.hasObject(docKey)).toBe(false);
    expect(await repository.getChunksByDocument('tenant_alpha', 'doc_to_delete')).toHaveLength(0);
  });
});
