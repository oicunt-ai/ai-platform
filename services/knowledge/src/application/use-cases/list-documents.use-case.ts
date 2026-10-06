import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { DocumentResponseDto } from '../dtos/document.dto.js';
import { toDocumentResponseDto } from '../dtos/document.dto.js';
import type { DocumentStatus } from '../../domain/index.js';
import { CollectionNotFoundError } from '../../domain/index.js';

export interface ListDocumentsOptions {
  readonly status?: DocumentStatus | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export class ListDocumentsUseCase {
  constructor(private readonly repository: DocumentRepositoryPort) {}

  public async execute(
    tenantId: string,
    collectionId: string,
    options?: ListDocumentsOptions,
  ): Promise<{ readonly documents: readonly DocumentResponseDto[]; readonly totalCount: number }> {
    const collection = await this.repository.getCollection(tenantId, collectionId);
    if (!collection) {
      throw new CollectionNotFoundError(collectionId);
    }

    const result = await this.repository.listDocuments(tenantId, collectionId, options);
    return {
      documents: result.documents.map(toDocumentResponseDto),
      totalCount: result.totalCount,
    };
  }
}
