import type { UpdateModelVersionStatusDto } from '../dtos/catalog.dto.js';
import type { ModelVersionData } from '../../domain/types.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { AuditRepositoryPort } from '../ports/audit-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import { AuditEvent, ModelNotFoundError } from '../../domain/index.js';

export class UpdateModelVersionStatusUseCase {
  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly auditRepository: AuditRepositoryPort,
    private readonly cache: ModelCachePort,
  ) {}

  public async execute(dto: UpdateModelVersionStatusDto): Promise<ModelVersionData> {
    const model = await this.modelRepository.findById(dto.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(dto.canonicalModelId);
    }

    const currentVersion = model.getVersion(dto.version);
    const beforeState = currentVersion?.toJSON() as unknown as Record<string, unknown> | undefined;
    const expectedVersionLock = model.versionLock;

    const updated = model.updateVersionStatus(dto.version, dto.status);
    model.incrementVersionLock();

    await this.modelRepository.save(model, expectedVersionLock);

    const auditEvent = new AuditEvent({
      entityType: 'model_version',
      entityId: `${model.id}:${dto.version}`,
      action: dto.status === 'deprecated' ? 'DEPRECATE' : 'STATUS_CHANGE',
      actorId: dto.actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
      beforeState,
      afterState: updated.toJSON() as unknown as Record<string, unknown>,
    });

    await this.auditRepository.append(auditEvent);
    // Instant emergency purge
    await this.cache.invalidateModel(model.id);

    return updated.toJSON();
  }
}
