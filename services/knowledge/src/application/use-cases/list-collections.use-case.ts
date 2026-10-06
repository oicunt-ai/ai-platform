import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { CollectionResponseDto } from '../dtos/collection.dto.js';
import { toCollectionResponseDto } from '../dtos/collection.dto.js';

export class ListCollectionsUseCase {
  constructor(private readonly repository: DocumentRepositoryPort) {}

  public async execute(tenantId: string): Promise<readonly CollectionResponseDto[]> {
    const collections = await this.repository.listCollections(tenantId);
    return collections.map(toCollectionResponseDto);
  }
}
