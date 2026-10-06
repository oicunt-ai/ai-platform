import type { Document, DocumentErrorDetails, DocumentStatus } from '../../domain/index.js';

export interface RegisterDocumentInputDto {
  readonly title: string;
  readonly mimeType: string;
  readonly objectKey: string;
  readonly sourceUri?: string | undefined;
  readonly contentLengthBytes?: number | undefined;
  readonly documentHash?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface DocumentResponseDto {
  readonly id: string;
  readonly collectionId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly status: DocumentStatus;
  readonly objectKey: string;
  readonly sourceUri?: string | undefined;
  readonly mimeType: string;
  readonly contentLengthBytes: number;
  readonly documentHash: string;
  readonly totalChunks: number;
  readonly totalTokens: number;
  readonly error?: DocumentErrorDetails | undefined;
  readonly metadata: Record<string, unknown>;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly indexedAt?: string | undefined;
}

export interface DocumentDeletedResponseDto {
  readonly documentId: string;
  readonly status: 'deleted';
  readonly deletedAt: string;
}

export function toDocumentResponseDto(doc: Document): DocumentResponseDto {
  return {
    id: doc.id,
    collectionId: doc.collectionId,
    tenantId: doc.tenantId,
    title: doc.title,
    status: doc.status,
    objectKey: doc.objectKey,
    sourceUri: doc.sourceUri,
    mimeType: doc.mimeType,
    contentLengthBytes: doc.contentLengthBytes,
    documentHash: doc.documentHash,
    totalChunks: doc.totalChunks,
    totalTokens: doc.totalTokens,
    error: doc.error,
    metadata: doc.metadata,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    indexedAt: doc.indexedAt,
  };
}
