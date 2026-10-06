import { randomUUID } from 'node:crypto';
import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { DocumentProcessingQueuePort } from '../ports/document-processing-queue.port.js';
import type { DocumentResponseDto } from '../dtos/document.dto.js';
import { toDocumentResponseDto } from '../dtos/document.dto.js';
import { DocumentNotFoundError, InvalidRequestError } from '../../domain/index.js';

export class RetryDocumentUseCase {
  constructor(
    private readonly repository: DocumentRepositoryPort,
    private readonly queue: DocumentProcessingQueuePort,
  ) {}

  public async execute(
    tenantId: string,
    documentId: string,
    context: { readonly correlationId: string },
  ): Promise<DocumentResponseDto> {
    const document = await this.repository.getDocument(tenantId, documentId);
    if (!document) {
      throw new DocumentNotFoundError(documentId);
    }

    if (document.status !== 'failed') {
      throw new InvalidRequestError(
        `Only documents in 'failed' status can be retried (current status: '${document.status}')`,
      );
    }

    // Reset error and transition back to queued
    await this.repository.updateDocumentStatus(tenantId, documentId, 'queued', undefined);
    const updatedDoc = {
      ...document,
      status: 'queued' as const,
      error: undefined,
      updatedAt: new Date().toISOString(),
    };

    // Publish job
    await this.queue.publishJob({
      eventId: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      documentId,
      collectionId: document.collectionId,
      tenantId,
      objectKey: document.objectKey,
      sourceUri: document.sourceUri,
      mimeType: document.mimeType,
      correlationId: context.correlationId,
      timestamp: new Date().toISOString(),
      attemptNumber: 1,
    });

    return toDocumentResponseDto(updatedDoc);
  }
}
