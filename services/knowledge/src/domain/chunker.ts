import type { Document } from './document.js';
import type { DocumentChunk } from './chunk.js';
import type { EmbeddingModelConfig } from './types.js';
import { createDocumentChunk } from './chunk.js';

export interface ChunkerOptions {
  /** Maximum estimated tokens per chunk (default: 500) */
  readonly maxTokensPerChunk?: number | undefined;
  /** Overlap in estimated tokens between successive chunks (default: 50) */
  readonly overlapTokens?: number | undefined;
}

export const DEFAULT_MAX_TOKENS_PER_CHUNK = 500;
export const DEFAULT_OVERLAP_TOKENS = 50;

export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Deterministic text chunker for the Knowledge Service.
 * Breaks text into overlapping windows without cutting sentences or words where possible.
 */
export function chunkText(
  doc: Document,
  text: string,
  embeddingConfig: EmbeddingModelConfig,
  options: ChunkerOptions = {},
): readonly DocumentChunk[] {
  const maxTokens = Math.max(50, options.maxTokensPerChunk ?? DEFAULT_MAX_TOKENS_PER_CHUNK);
  const overlapTokens = Math.max(
    0,
    Math.min(options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS, Math.floor(maxTokens / 2)),
  );

  // Approximate 4 chars per token
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  const stepChars = Math.max(50, maxChars - overlapChars);

  const cleanText = text.trim();
  if (cleanText.length === 0) {
    return [];
  }

  // If text fits in a single chunk, return immediately
  if (cleanText.length <= maxChars) {
    return [
      createDocumentChunk({
        id: `chk_${doc.id}_0`,
        tenantId: doc.tenantId,
        collectionId: doc.collectionId,
        documentId: doc.id,
        chunkIndex: 0,
        text: cleanText,
        tokenEstimate: Math.max(1, Math.ceil(cleanText.length / 4)),
        embeddingMetadata: embeddingConfig,
        metadata: {
          ...doc.metadata,
          sourceUri: doc.sourceUri,
          documentTitle: doc.title,
        },
      }),
    ];
  }

  const chunks: DocumentChunk[] = [];
  let startIndex = 0;
  let chunkIndex = 0;

  while (startIndex < cleanText.length) {
    let endIndex = startIndex + maxChars;

    if (endIndex < cleanText.length) {
      // Find a convenient boundary (double newline, newline, period, space)
      const lookbackLimit = Math.max(startIndex, endIndex - 100);
      let breakIndex = cleanText.lastIndexOf('\n\n', endIndex);
      if (breakIndex < lookbackLimit) {
        breakIndex = cleanText.lastIndexOf('\n', endIndex);
      }
      if (breakIndex < lookbackLimit) {
        breakIndex = cleanText.lastIndexOf('. ', endIndex);
        if (breakIndex >= lookbackLimit) {
          breakIndex += 1; // Include period
        }
      }
      if (breakIndex < lookbackLimit) {
        breakIndex = cleanText.lastIndexOf(' ', endIndex);
      }
      if (breakIndex >= lookbackLimit) {
        endIndex = breakIndex + 1;
      }
    } else {
      endIndex = cleanText.length;
    }

    const chunkContent = cleanText.substring(startIndex, endIndex).trim();
    if (chunkContent.length > 0) {
      chunks.push(
        createDocumentChunk({
          id: `chk_${doc.id}_${chunkIndex}`,
          tenantId: doc.tenantId,
          collectionId: doc.collectionId,
          documentId: doc.id,
          chunkIndex,
          text: chunkContent,
          tokenEstimate: Math.max(1, Math.ceil(chunkContent.length / 4)),
          embeddingMetadata: embeddingConfig,
          metadata: {
            ...doc.metadata,
            sourceUri: doc.sourceUri,
            documentTitle: doc.title,
          },
        }),
      );
      chunkIndex++;
    }

    if (endIndex >= cleanText.length) {
      break;
    }

    startIndex += stepChars;
  }

  return chunks;
}
