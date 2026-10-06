import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { VectorStorePort } from '../ports/vector-store.port.js';
import { CollectionNotFoundError } from '../../domain/index.js';

export class DeleteCollectionUseCase {
  constructor(
    private readonly repository: DocumentRepositoryPort,
    private readonly vectorStore: VectorStorePort,
  ) {}

  public async execute(tenantId: string, collectionId: string): Promise<boolean> {
    const collection = await this.repository.getCollection(tenantId, collectionId);
    if (!collection) {
      throw new CollectionNotFoundError(collectionId);
    }

    // Clean up vectors and chunks
    await this.vectorStore.deleteVectorsByCollection(tenantId, collectionId);
    await this.repository.deleteChunksByCollection(tenantId, collectionId);
    return await this.repository.deleteCollection(tenantId, collectionId);
  }
}
