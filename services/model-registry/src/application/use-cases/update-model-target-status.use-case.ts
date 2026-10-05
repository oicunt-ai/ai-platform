import type { UpdateModelTargetStatusDto } from '../dtos/catalog.dto.js';
import type { ModelTargetData } from '../../domain/types.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { AuditRepositoryPort } from '../ports/audit-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import { AuditEvent, ModelNotFoundError } from '../../domain/index.js';

export class UpdateModelTargetStatusUseCase {
  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly auditRepository: AuditRepositoryPort,
    private readonly cache: ModelCachePort,
  ) {}

  public async execute(dto: UpdateModelTargetStatusDto): Promise<ModelTargetData> {
    const model = await this.modelRepository.findById(dto.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(dto.canonicalModelId);
    }

    const currentTarget = model.getTarget(dto.targetId);
    const beforeState = currentTarget?.toJSON() as unknown as Record<string, unknown> | undefined;
    const expectedVersionLock = model.versionLock;

    const updated = model.updateTargetStatus(dto.targetId, dto.status);
    model.incrementVersionLock();

    await this.modelRepository.save(model, expectedVersionLock);

    const auditEvent = new AuditEvent({
      entityType: 'model_target',
      entityId: `${model.id}:${dto.targetId}`,
      action: 'STATUS_CHANGE',
      actorId: dto.actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
      beforeState,
      afterState: updated.toJSON() as unknown as Record<string, unknown>,
    });

    await this.auditRepository.append(auditEvent);
    await this.cache.invalidateModel(model.id);

    return updated.toJSON();
  }
}
