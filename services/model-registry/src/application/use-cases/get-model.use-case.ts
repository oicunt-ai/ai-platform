import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { CanonicalModelDetailDto } from '../dtos/catalog.dto.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import { ModelNotFoundError } from '../../domain/index.js';

export class GetModelUseCase {
  constructor(private readonly modelRepository: ModelRepositoryPort) {}

  public async execute(canonicalModelId: CanonicalModelId): Promise<CanonicalModelDetailDto> {
    const model = await this.modelRepository.findById(canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(canonicalModelId);
    }

    return {
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      family: model.family,
      activeVersion: model.activeVersion,
      versionLock: model.versionLock,
      versions: model.getVersions().map((v) => v.toJSON()),
      targets: model.getTargets().map((t) => t.toJSON()),
      routingPolicy: model.routingPolicy.toJSON(),
      aliases: model.getAliases().map((a) => a.toJSON()),
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}
