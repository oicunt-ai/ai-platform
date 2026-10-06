import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { CollectionResponseDto } from '../dtos/collection.dto.js';
import { toCollectionResponseDto } from '../dtos/collection.dto.js';
import { CollectionNotFoundError } from '../../domain/index.js';

export class GetCollectionUseCase {
  constructor(private readonly repository: DocumentRepositoryPort) {}

  public async execute(tenantId: string, collectionId: string): Promise<CollectionResponseDto> {
    const collection = await this.repository.getCollection(tenantId, collectionId);
    if (!collection) {
      throw new CollectionNotFoundError(collectionId);
    }
    return toCollectionResponseDto(collection);
  }
}
