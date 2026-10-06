import { describe, expect, it } from 'vitest';
import { InMemoryDocumentRepository } from '../../../src/infrastructure/repositories/in-memory-document.repository.js';
import { InMemoryVectorStore } from '../../../src/infrastructure/vector-store/in-memory-vector-store.js';
import { InMemoryObjectStorage } from '../../../src/infrastructure/object-storage/in-memory-object-storage.js';
import { PurgeTenantKnowledgeUseCase } from '../../../src/application/use-cases/purge-tenant-knowledge.use-case.js';
import { createKnowledgeCollection } from '../../../src/domain/collection.js';
import { createDocument } from '../../../src/domain/document.js';
import { createDocumentChunk } from '../../../src/domain/chunk.js';

describe('PurgeTenantKnowledgeUseCase - Tenant Purge Compliance', () => {
  it('purges all collections, documents, chunks, vectors, and files for a tenant while preserving others', async () => {
    const repository = new InMemoryDocumentRepository();
    const vectorStore = new InMemoryVectorStore();
    const objectStorage = new InMemoryObjectStorage();

    // 1. Setup tenant A
    const colA = createKnowledgeCollection({
      id: 'col_a',
      tenantId: 'tenant_purge_a',
      name: 'Tenant A Col',
      embeddingConfig: { modelId: 'mock', dimensions: 4, version: '1.0' },
    });
    await repository.createCollection(colA);

    const docA = createDocument({
      id: 'doc_a',
      tenantId: 'tenant_purge_a',
      collectionId: 'col_a',
      title: 'Doc A',
      objectKey: 'tenant_purge_a/docA.txt',
      mimeType: 'text/plain',
      contentLengthBytes: 10,
      documentHash: 'hA',
    });
    await repository.createDocument(docA);
    await objectStorage.putObject(docA.objectKey, Buffer.from('content A'), {
      mimeType: 'text/plain',
      tenantId: 'tenant_purge_a',
    });

    const chkA = createDocumentChunk({
      id: 'chk_a',
      tenantId: 'tenant_purge_a',
      documentId: 'doc_a',
      collectionId: 'col_a',
      chunkIndex: 0,
      text: 'content A',
      tokenEstimate: 2,
      embeddingMetadata: { modelId: 'mock', dimensions: 4, version: '1.0' },
    });
    await repository.saveChunks([chkA]);
    await vectorStore.upsertVectors([
      {
        id: chkA.id,
        documentId: 'doc_a',
        collectionId: 'col_a',
        tenantId: 'tenant_purge_a',
        vector: [1, 0, 0, 0],
        payload: {},
      },
    ]);

    // 2. Setup tenant B
    const colB = createKnowledgeCollection({
      id: 'col_b',
      tenantId: 'tenant_preserve_b',
      name: 'Tenant B Col',
      embeddingConfig: { modelId: 'mock', dimensions: 4, version: '1.0' },
    });
    await repository.createCollection(colB);

    const docB = createDocument({
      id: 'doc_b',
      tenantId: 'tenant_preserve_b',
      collectionId: 'col_b',
      title: 'Doc B',
      objectKey: 'tenant_preserve_b/docB.txt',
      mimeType: 'text/plain',
      contentLengthBytes: 10,
      documentHash: 'hB',
    });
    await repository.createDocument(docB);
    await objectStorage.putObject(docB.objectKey, Buffer.from('content B'), {
      mimeType: 'text/plain',
      tenantId: 'tenant_preserve_b',
    });

    // 3. Purge tenant A
    const purgeUseCase = new PurgeTenantKnowledgeUseCase(repository, vectorStore, objectStorage);
    const purgeResult = await purgeUseCase.execute('tenant_purge_a');

    expect(purgeResult.tenantId).toBe('tenant_purge_a');
    expect(purgeResult.collectionsDeleted).toBe(1);
    expect(purgeResult.documentsDeleted).toBe(1);
    expect(purgeResult.chunksDeleted).toBe(1);
    expect(purgeResult.objectsDeleted).toBe(1);

    // 4. Verify tenant A is empty
    expect(await repository.listCollections('tenant_purge_a')).toHaveLength(0);
    expect(await repository.getDocument('tenant_purge_a', 'doc_a')).toBeNull();
    expect(await objectStorage.hasObject('tenant_purge_a/docA.txt')).toBe(false);

    // 5. Verify tenant B is completely untouched
    expect(await repository.listCollections('tenant_preserve_b')).toHaveLength(1);
    expect(await repository.getDocument('tenant_preserve_b', 'doc_b')).toBeDefined();
    expect(await objectStorage.hasObject('tenant_preserve_b/docB.txt')).toBe(true);
  });
});
