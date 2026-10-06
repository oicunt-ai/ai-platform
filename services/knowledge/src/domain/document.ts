import type { DocumentStatus, DocumentErrorDetails } from './types.js';
import { InvalidRequestError } from './errors.js';

export interface Document {
  readonly id: string;
  readonly tenantId: string;
  readonly collectionId: string;
  readonly title: string;
  /** Opaque object key/reference in Object Storage */
  readonly objectKey: string;
  /** Optional canonical source URI or external reference */
  readonly sourceUri?: string | undefined;
  readonly mimeType: string;
  readonly status: DocumentStatus;
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
  readonly deletedAt?: string | undefined;
}

export interface CreateDocumentParams {
  readonly id: string;
  readonly tenantId: string;
  readonly collectionId: string;
  readonly title: string;
  readonly objectKey: string;
  readonly sourceUri?: string | undefined;
  readonly mimeType: string;
  readonly contentLengthBytes?: number | undefined;
  readonly documentHash: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly createdBy?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

const ALLOWED_STATUS_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  created: ['queued', 'failed', 'deleted'],
  queued: ['processing', 'failed', 'deleted'],
  processing: ['ready', 'failed', 'deleted'],
  ready: ['deleted'],
  failed: ['queued', 'deleted'],
  deleted: [],
};

export function isValidDocumentTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

export function validateDocumentTransition(from: DocumentStatus, to: DocumentStatus): void {
  if (!isValidDocumentTransition(from, to)) {
    throw new InvalidRequestError(`Invalid document status transition from '${from}' to '${to}'`);
  }
}

export const canTransitionStatus = isValidDocumentTransition;
export const validateStatusTransition = validateDocumentTransition;

export function createDocument(params: CreateDocumentParams): Document {
  if (!params.tenantId || params.tenantId.trim().length === 0) {
    throw new InvalidRequestError('Document tenantId must not be empty');
  }
  if (!params.collectionId || params.collectionId.trim().length === 0) {
    throw new InvalidRequestError('Document collectionId must not be empty');
  }
  if (!params.title || params.title.trim().length === 0) {
    throw new InvalidRequestError('Document title must not be empty');
  }
  if (!params.objectKey || params.objectKey.trim().length === 0) {
    throw new InvalidRequestError('Document objectKey must not be empty');
  }
  if (!params.mimeType || params.mimeType.trim().length === 0) {
    throw new InvalidRequestError('Document mimeType must not be empty');
  }
  if (!params.documentHash || params.documentHash.trim().length === 0) {
    throw new InvalidRequestError('Document documentHash must not be empty');
  }

  const now = new Date().toISOString();
  return {
    id: params.id,
    tenantId: params.tenantId.trim(),
    collectionId: params.collectionId.trim(),
    title: params.title.trim(),
    objectKey: params.objectKey.trim(),
    sourceUri: params.sourceUri?.trim(),
    mimeType: params.mimeType.trim().toLowerCase(),
    status: 'created',
    contentLengthBytes: params.contentLengthBytes ?? 0,
    documentHash: params.documentHash.trim(),
    totalChunks: 0,
    totalTokens: 0,
    metadata: params.metadata ?? {},
    createdBy:
      params.createdBy && params.createdBy.trim().length > 0 ? params.createdBy.trim() : 'system',
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}
