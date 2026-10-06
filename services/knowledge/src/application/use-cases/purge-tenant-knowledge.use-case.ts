import type { DocumentRepositoryPort } from '../ports/document-repository.port.js';
import type { VectorStorePort } from '../ports/vector-store.port.js';
import type { ObjectStoragePort } from '../ports/object-storage.port.js';
import type { TenantPurgeResponseDto } from '../dtos/purge.dto.js';
import { TenantPurgeFailedError } from '../../domain/index.js';

export class PurgeTenantKnowledgeUseCase {
  constructor(
    private readonly repository: DocumentRepositoryPort,
    private readonly vectorStore: VectorStorePort,
    private readonly objectStorage: ObjectStoragePort,
  ) {}

  public async execute(tenantId: string): Promise<TenantPurgeResponseDto> {
    try {
      // 1. Purge vectors
      await this.vectorStore.purgeTenantVectors(tenantId);

      // 2. Purge relational database records (documents, chunks, collections)
      const dataResult = await this.repository.purgeTenantData(tenantId);

      // 3. Purge objects with tenant prefix
      const objectsDeleted = await this.objectStorage.deleteObjectsByPrefix(`${tenantId}/`);

      return {
        tenantId,
        collectionsDeleted: dataResult.collectionsDeleted,
        documentsDeleted: dataResult.documentsDeleted,
        chunksDeleted: dataResult.chunksDeleted,
        vectorsDeleted: dataResult.chunksDeleted,
        objectsDeleted,
        purgedAt: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TenantPurgeFailedError(`Failed to purge tenant '${tenantId}': ${message}`, err);
    }
  }
}
