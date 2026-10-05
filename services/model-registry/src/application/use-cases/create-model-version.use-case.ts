import type { CreateModelVersionDto } from '../dtos/catalog.dto.js';
import type { ModelVersionData } from '../../domain/types.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { AuditRepositoryPort } from '../ports/audit-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import { AuditEvent, ModelNotFoundError, ModelVersion } from '../../domain/index.js';

export class CreateModelVersionUseCase {
  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly auditRepository: AuditRepositoryPort,
    private readonly cache: ModelCachePort,
  ) {}

  public async execute(dto: CreateModelVersionDto): Promise<ModelVersionData> {
    const model = await this.modelRepository.findById(dto.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(dto.canonicalModelId);
    }

    const expectedVersionLock = model.versionLock;
    const beforeState = model.toJSON() as unknown as Record<string, unknown>;

    const version = new ModelVersion({
      canonicalModelId: model.id,
      version: dto.version,
      modalities: dto.modalities,
      capabilities: dto.capabilities,
      limits: dto.limits,
      pricing: dto.pricing,
      status: dto.status ?? 'available',
      isImmutable: dto.isImmutable ?? true,
    });

    model.addVersion(version);
    model.incrementVersionLock();

    await this.modelRepository.save(model, expectedVersionLock);

    const auditEvent = new AuditEvent({
      entityType: 'model_version',
      entityId: `${model.id}:${version.version}`,
      action: 'CREATE',
      actorId: dto.actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
      beforeState,
      afterState: version.toJSON() as unknown as Record<string, unknown>,
    });

    await this.auditRepository.append(auditEvent);
    await this.cache.invalidateModel(model.id);

    return version.toJSON();
  }
}
