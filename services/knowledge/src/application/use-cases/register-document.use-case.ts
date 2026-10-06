import { createHash, randomUUID } from 'node:crypto';
import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { DocumentProcessingQueuePort } from '../ports/document-processing-queue.port.js';
import type { RegisterDocumentInputDto, DocumentResponseDto } from '../dtos/document.dto.js';
import { toDocumentResponseDto } from '../dtos/document.dto.js';
import {
  createDocument,
  CollectionNotFoundError,
  DocumentAlreadyExistsError,
} from '../../domain/index.js';

export class RegisterDocumentUseCase {
  constructor(
    private readonly repository: DocumentRepositoryPort,
    private readonly queue: DocumentProcessingQueuePort,
  ) {}

  public async execute(
    tenantId: string,
    collectionId: string,
    dto: RegisterDocumentInputDto,
    context: { readonly userId?: string | undefined; readonly correlationId: string },
  ): Promise<DocumentResponseDto> {
    const collection = await this.repository.getCollection(tenantId, collectionId);
    if (!collection) {
      throw new CollectionNotFoundError(collectionId);
    }

    const documentHash =
      dto.documentHash && dto.documentHash.trim().length > 0
        ? dto.documentHash.trim()
        : createHash('sha256').update(`${collectionId}:${dto.objectKey}`).digest('hex');

    const existing = await this.repository.getDocumentByHash(tenantId, collectionId, documentHash);
    if (existing && existing.status !== 'deleted') {
      throw new DocumentAlreadyExistsError(documentHash);
    }

    const documentId = `doc_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const createdBy = context.userId ?? 'system';

    const document = createDocument({
      id: documentId,
      tenantId,
      collectionId,
      title: dto.title,
      objectKey: dto.objectKey,
      sourceUri: dto.sourceUri,
      mimeType: dto.mimeType,
      contentLengthBytes: dto.contentLengthBytes,
      documentHash,
      metadata: dto.metadata,
      createdBy,
    });

    await this.repository.createDocument(document);

    // Transition immediately to queued
    await this.repository.updateDocumentStatus(tenantId, documentId, 'queued');
    const queuedDoc = { ...document, status: 'queued' as const };

    // Publish to background job queue
    await this.queue.publishJob({
      eventId: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      documentId,
      collectionId,
      tenantId,
      objectKey: dto.objectKey,
      sourceUri: dto.sourceUri,
      mimeType: dto.mimeType,
      correlationId: context.correlationId,
      timestamp: new Date().toISOString(),
      attemptNumber: 1,
    });

    return toDocumentResponseDto(queuedDoc);
  }
}
