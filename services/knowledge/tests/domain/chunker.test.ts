import { describe, expect, it } from 'vitest';
import { chunkText, estimateTokens } from '../../src/domain/chunker.js';
import { createDocument } from '../../src/domain/document.js';

describe('Deterministic Chunker & Token Estimator', () => {
  const dummyDoc = createDocument({
    id: 'doc_1',
    tenantId: 'tenant_1',
    collectionId: 'col_1',
    title: 'Test Doc',
    objectKey: 'tenant_1/test.txt',
    mimeType: 'text/plain',
    documentHash: 'hash123',
    createdBy: 'test_user',
  });

  const embeddingConfig = {
    modelId: 'text-embedding-3-small',
    dimensions: 1536,
    version: '1.0.0',
  };

  it('estimates tokens proportionally to character length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBe(3); // 11 / 4 rounded up
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('handles empty or whitespace-only text gracefully', () => {
    expect(chunkText(dummyDoc, '', embeddingConfig)).toEqual([]);
    expect(chunkText(dummyDoc, '   \n\n\t  ', embeddingConfig)).toEqual([]);
  });

  it('chunks small text into a single chunk', () => {
    const text = 'This is a short test document.';
    const chunks = chunkText(dummyDoc, text, embeddingConfig);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.documentId).toBe('doc_1');
    expect(chunks[0]!.collectionId).toBe('col_1');
    expect(chunks[0]!.tenantId).toBe('tenant_1');
    expect(chunks[0]!.text).toBe(text);
    expect(chunks[0]!.tokenEstimate).toBeGreaterThan(0);
  });

  it('chunks large text into multiple overlapping chunks deterministically', () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, i) =>
        `Paragraph ${i + 1}: ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(5)}`,
    );
    const fullText = paragraphs.join('\n\n');

    const chunks1 = chunkText(dummyDoc, fullText, embeddingConfig, {
      maxTokensPerChunk: 100,
      overlapTokens: 20,
    });
    const chunks2 = chunkText(dummyDoc, fullText, embeddingConfig, {
      maxTokensPerChunk: 100,
      overlapTokens: 20,
    });

    expect(chunks1.length).toBeGreaterThan(1);
    // Deterministic invariant
    expect(chunks1.map((c) => ({ id: c.id, text: c.text, chunkIndex: c.chunkIndex }))).toEqual(
      chunks2.map((c) => ({ id: c.id, text: c.text, chunkIndex: c.chunkIndex })),
    );

    // Sequence index invariant: monotonically increasing 0..N-1
    for (let i = 0; i < chunks1.length; i++) {
      expect(chunks1[i]!.chunkIndex).toBe(i);
      expect(chunks1[i]!.documentId).toBe('doc_1');
      expect(chunks1[i]!.collectionId).toBe('col_1');
      expect(chunks1[i]!.tenantId).toBe('tenant_1');
      expect(chunks1[i]!.tokenEstimate).toBeLessThanOrEqual(150);
    }
  });
});
