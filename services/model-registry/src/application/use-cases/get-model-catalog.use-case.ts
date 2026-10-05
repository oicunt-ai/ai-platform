import type { ModelCatalogEntryDto } from '../dtos/catalog.dto.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import { VersionNotFoundError } from '../../domain/index.js';

export interface GetModelCatalogOptions {
  readonly selectableOnly?: boolean | undefined;
  readonly family?: string | undefined;
}

export class GetModelCatalogUseCase {
  constructor(private readonly modelRepository: ModelRepositoryPort) {}

  public async execute(
    options: GetModelCatalogOptions = {},
  ): Promise<readonly ModelCatalogEntryDto[]> {
    const selectableOnly = options.selectableOnly ?? true;
    const models = await this.modelRepository.listAll();

    const catalogEntries: ModelCatalogEntryDto[] = [];

    for (const model of models) {
      const activeVersion = model.getVersions().find((v) => v.version === model.activeVersion);

      if (!activeVersion) {
        throw new VersionNotFoundError(model.id, model.activeVersion);
      }

      const isSelectable =
        activeVersion.status === 'available' || activeVersion.status === 'degraded';

      if (selectableOnly && !isSelectable) {
        continue;
      }

      if (options.family && model.family?.toLowerCase() !== options.family.toLowerCase()) {
        continue;
      }

      catalogEntries.push({
        id: model.id,
        displayName: model.displayName,
        description: model.description,
        family: model.family,
        activeVersion: model.activeVersion,
        modalities: activeVersion.modalities,
        capabilities: activeVersion.capabilities,
        limits: activeVersion.limits,
        pricing: activeVersion.pricing,
        status: activeVersion.status,
        isSelectable,
      });
    }

    // Deterministic ordering: family ASC, then displayName ASC, then id ASC
    catalogEntries.sort((a, b) => {
      const familyA = a.family ?? '';
      const familyB = b.family ?? '';
      if (familyA !== familyB) {
        return familyA.localeCompare(familyB);
      }
      const nameCompare = a.displayName.localeCompare(b.displayName);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.id.localeCompare(b.id);
    });

    return Object.freeze(catalogEntries);
  }
}
