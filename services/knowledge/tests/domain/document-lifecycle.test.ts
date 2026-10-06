import { describe, expect, it } from 'vitest';
import {
  canTransitionStatus,
  createDocument,
  createKnowledgeCollection,
  validateStatusTransition,
  InvalidRequestError,
} from '../../src/domain/index.js';

describe('Document Lifecycle & State Machine Specification', () => {
  it('creates valid collection and enforces required fields', () => {
    const col = createKnowledgeCollection({
      id: 'col_1',
      tenantId: 'tenant_alpha',
      name: 'Engineering Docs',
      description: 'API specs and architecture',
      embeddingConfig: {
        modelId: 'text-embedding-3-small',
        dimensions: 1536,
        version: '1.0.0',
      },
    });

    expect(col.id).toBe('col_1');
    expect(col.tenantId).toBe('tenant_alpha');
    expect(col.name).toBe('Engineering Docs');
    expect(col.embeddingConfig.dimensions).toBe(1536);
    expect(col.createdAt).toBeDefined();
    expect(col.updatedAt).toBeDefined();
  });

  it('rejects invalid collection parameters', () => {
    expect(() =>
      createKnowledgeCollection({
        id: '',
        tenantId: 'tenant_alpha',
        name: 'Docs',
        embeddingConfig: { modelId: 'test', dimensions: 1536, version: '1.0' },
      }),
    ).toThrow(InvalidRequestError);

    expect(() =>
      createKnowledgeCollection({
        id: 'col_1',
        tenantId: 'tenant_alpha',
        name: 'Docs',
        embeddingConfig: { modelId: 'test', dimensions: -1, version: '1.0' },
      }),
    ).toThrow(InvalidRequestError);
  });

  it('creates document with initial status created', () => {
    const doc = createDocument({
      id: 'doc_1',
      tenantId: 'tenant_alpha',
      collectionId: 'col_1',
      title: 'Arch Spec',
      objectKey: 'tenant_alpha/arch.md',
      mimeType: 'text/markdown',
      contentLengthBytes: 1024,
      documentHash: 'abc123hash',
      createdBy: 'user_1',
    });

    expect(doc.id).toBe('doc_1');
    expect(doc.status).toBe('created');
    expect(doc.totalChunks).toBe(0);
    expect(doc.totalTokens).toBe(0);
    expect(doc.error).toBeUndefined();
  });

  describe('State Machine Transitions', () => {
    it('allows valid transitions according to contract state machine', () => {
      // created -> queued, failed, deleted
      expect(canTransitionStatus('created', 'queued')).toBe(true);
      expect(canTransitionStatus('created', 'failed')).toBe(true);
      expect(canTransitionStatus('created', 'deleted')).toBe(true);
      expect(canTransitionStatus('created', 'ready')).toBe(false);

      // queued -> processing, failed, deleted
      expect(canTransitionStatus('queued', 'processing')).toBe(true);
      expect(canTransitionStatus('queued', 'failed')).toBe(true);
      expect(canTransitionStatus('queued', 'deleted')).toBe(true);
      expect(canTransitionStatus('queued', 'ready')).toBe(false);

      // processing -> ready, failed, deleted
      expect(canTransitionStatus('processing', 'ready')).toBe(true);
      expect(canTransitionStatus('processing', 'failed')).toBe(true);
      expect(canTransitionStatus('processing', 'deleted')).toBe(true);

      // ready -> deleted (terminal)
      expect(canTransitionStatus('ready', 'deleted')).toBe(true);
      expect(canTransitionStatus('ready', 'processing')).toBe(false);
      expect(canTransitionStatus('ready', 'queued')).toBe(false);

      // failed -> queued (retry), deleted
      expect(canTransitionStatus('failed', 'queued')).toBe(true);
      expect(canTransitionStatus('failed', 'deleted')).toBe(true);
      expect(canTransitionStatus('failed', 'ready')).toBe(false);

      // deleted is terminal
      expect(canTransitionStatus('deleted', 'created')).toBe(false);
      expect(canTransitionStatus('deleted', 'queued')).toBe(false);
      expect(canTransitionStatus('deleted', 'processing')).toBe(false);
      expect(canTransitionStatus('deleted', 'ready')).toBe(false);
      expect(canTransitionStatus('deleted', 'failed')).toBe(false);
    });

    it('throws InvalidRequestError on illegal transitions', () => {
      expect(() => validateStatusTransition('deleted', 'ready')).toThrow(InvalidRequestError);
      expect(() => validateStatusTransition('created', 'ready')).toThrow(InvalidRequestError);
      expect(() => validateStatusTransition('ready', 'queued')).toThrow(InvalidRequestError);
    });
  });
});
