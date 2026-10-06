import { describe, expect, it } from 'vitest';
import { InMemoryVectorStore } from '../../src/infrastructure/vector-store/in-memory-vector-store.js';

describe('InMemoryVectorStore Infrastructure Adapter', () => {
  it('upserts and retrieves vectors based on cosine similarity with tenant isolation', async () => {
    const store = new InMemoryVectorStore();

    // Insert 2 vectors for tenant_a
    await store.upsertVectors([
      {
        id: 'chunk_1',
        documentId: 'doc_1',
        collectionId: 'col_1',
        tenantId: 'tenant_a',
        vector: [1.0, 0.0, 0.0],
        payload: { category: 'architecture' },
      },
      {
        id: 'chunk_2',
        documentId: 'doc_1',
        collectionId: 'col_1',
        tenantId: 'tenant_a',
        vector: [0.0, 1.0, 0.0],
        payload: { category: 'database' },
      },
    ]);

    // Insert vector for tenant_b
    await store.upsertVectors([
      {
        id: 'chunk_3',
        documentId: 'doc_2',
        collectionId: 'col_2',
        tenantId: 'tenant_b',
        vector: [1.0, 0.0, 0.0],
        payload: {},
      },
    ]);

    // Query for tenant_a
    const resultsA = await store.searchVectors({
      tenantId: 'tenant_a',
      collectionIds: ['col_1'],
      vector: [0.9, 0.1, 0.0],
      topK: 5,
    });

    expect(resultsA.length).toBe(2);
    expect(resultsA[0]!.id).toBe('chunk_1');
    expect(resultsA[0]!.score).toBeGreaterThan(0.9);
    // Crucial: tenant_b vector is NOT returned
    expect(resultsA.some((r) => r.id === 'chunk_3')).toBe(false);

    // Query for tenant_b
    const resultsB = await store.searchVectors({
      tenantId: 'tenant_b',
      collectionIds: ['col_2'],
      vector: [1.0, 0.0, 0.0],
      topK: 5,
    });
    expect(resultsB.length).toBe(1);
    expect(resultsB[0]!.id).toBe('chunk_3');
  });

  it('respects minScore filter', async () => {
    const store = new InMemoryVectorStore();
    await store.upsertVectors([
      {
        id: 'c1',
        documentId: 'doc_1',
        collectionId: 'col_1',
        tenantId: 'tenant_a',
        vector: [1.0, 0.0, 0.0],
        payload: {},
      },
      {
        id: 'c2',
        documentId: 'doc_1',
        collectionId: 'col_1',
        tenantId: 'tenant_a',
        vector: [0.0, 1.0, 0.0],
        payload: {},
      },
    ]);

    const results = await store.searchVectors({
      tenantId: 'tenant_a',
      collectionIds: ['col_1'],
      vector: [1.0, 0.0, 0.0],
      topK: 5,
      minScore: 0.8,
    });

    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe('c1');
  });

  it('deletes vectors by document and by collection', async () => {
    const store = new InMemoryVectorStore();
    await store.upsertVectors([
      {
        id: 'c1',
        documentId: 'doc_1',
        collectionId: 'col_1',
        tenantId: 'tenant_a',
        vector: [1, 0, 0],
        payload: {},
      },
      {
        id: 'c2',
        documentId: 'doc_2',
        collectionId: 'col_1',
        tenantId: 'tenant_a',
        vector: [1, 0, 0],
        payload: {},
      },
    ]);

    await store.deleteVectorsByDocument('tenant_a', 'doc_1');
    let res = await store.searchVectors({
      tenantId: 'tenant_a',
      collectionIds: ['col_1'],
      vector: [1, 0, 0],
      topK: 5,
    });
    expect(res.length).toBe(1);
    expect(res[0]!.id).toBe('c2');

    await store.deleteVectorsByCollection('tenant_a', 'col_1');
    res = await store.searchVectors({
      tenantId: 'tenant_a',
      collectionIds: ['col_1'],
      vector: [1, 0, 0],
      topK: 5,
    });
    expect(res.length).toBe(0);
  });
});
