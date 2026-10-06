import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { VectorStorePort } from '../ports/vector-store.port.js';
import type { ObjectStoragePort } from '../ports/object-storage.port.js';
import type { DocumentDeletedResponseDto } from '../dtos/document.dto.js';
import { DocumentNotFoundError } from '../../domain/index.js';

export class DeleteDocumentUseCase {
  constructor(
    private readonly repository: DocumentRepositoryPort,
    private readonly vectorStore: VectorStorePort,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  public async execute(tenantId: string, documentId: string): Promise<DocumentDeletedResponseDto> {
    const document = await this.repository.getDocument(tenantId, documentId);
    if (!document) {
      throw new DocumentNotFoundError(documentId);
    }

    // 1. Immediately exclude from retrieval by marking status = 'deleted' in metadata store
    await this.repository.markDocumentDeleted(tenantId, documentId);
    const deletedAt = new Date().toISOString();

    // 2. Asynchronously / synchronously purge physical vectors, chunks, and storage blob
    try {
      await this.vectorStore.deleteVectorsByDocument(tenantId, documentId);
    } catch {
      // Continue cleanup even if vector store fails
    }

    try {
      await this.repository.deleteChunksByDocument(tenantId, documentId);
    } catch {
      // Continue cleanup
    }

    try {
      await this.objectStorage.deleteObject(document.objectKey);
    } catch {
      // Continue cleanup
    }

    return {
      documentId,
      status: 'deleted',
      deletedAt,
    };
  }
}
