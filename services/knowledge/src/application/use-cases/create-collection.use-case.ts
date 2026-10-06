import { randomUUID } from 'node:crypto';
import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { CreateCollectionInputDto, CollectionResponseDto } from '../dtos/collection.dto.js';
import { toCollectionResponseDto } from '../dtos/collection.dto.js';
import { createKnowledgeCollection, CollectionAlreadyExistsError } from '../../domain/index.js';

export class CreateCollectionUseCase {
  constructor(private readonly repository: DocumentRepositoryPort) {}

  public async execute(
    tenantId: string,
    dto: CreateCollectionInputDto,
  ): Promise<CollectionResponseDto> {
    const existing = await this.repository.getCollectionByName(tenantId, dto.name.trim());
    if (existing) {
      throw new CollectionAlreadyExistsError(dto.name.trim());
    }

    const id = `col_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const collection = createKnowledgeCollection({
      id,
      tenantId,
      name: dto.name,
      description: dto.description,
      embeddingConfig: dto.embeddingConfig,
      metadata: dto.metadata,
    });

    await this.repository.createCollection(collection);
    return toCollectionResponseDto(collection);
  }
}
