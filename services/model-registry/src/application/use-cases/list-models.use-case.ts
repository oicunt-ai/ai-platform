import type { CanonicalModelSummaryDto } from '../dtos/catalog.dto.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';

export class ListModelsUseCase {
  constructor(private readonly modelRepository: ModelRepositoryPort) {}

  public async execute(): Promise<readonly CanonicalModelSummaryDto[]> {
    const models = await this.modelRepository.listAll();
    return models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      family: model.family,
      activeVersion: model.activeVersion,
      versionsCount: model.getVersions().length,
      targetsCount: model.getTargets().length,
    }));
  }
}
