import type { SetModelAliasDto } from '../dtos/catalog.dto.js';
import type { ModelAliasData } from '../../domain/types.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { AuditRepositoryPort } from '../ports/audit-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import { AuditEvent, ModelAlias, ModelNotFoundError } from '../../domain/index.js';

export class SetModelAliasUseCase {
  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly auditRepository: AuditRepositoryPort,
    private readonly cache: ModelCachePort,
  ) {}

  public async execute(dto: SetModelAliasDto): Promise<ModelAliasData> {
    const model = await this.modelRepository.findById(dto.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(dto.canonicalModelId);
    }

    const expectedVersionLock = model.versionLock;
    const alias = new ModelAlias({
      canonicalModelId: model.id,
      aliasName: dto.aliasName,
      targetVersion: dto.targetVersion,
      tenantId: dto.tenantId,
    });

    model.setAlias(alias);
    model.incrementVersionLock();

    await this.modelRepository.save(model, expectedVersionLock);

    const auditEvent = new AuditEvent({
      entityType: 'model_alias',
      entityId: `${model.id}:${alias.aliasName}`,
      action: 'UPDATE',
      actorId: dto.actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
      afterState: alias.toJSON() as unknown as Record<string, unknown>,
    });

    await this.auditRepository.append(auditEvent);
    await this.cache.invalidateModel(model.id);

    return alias.toJSON();
  }
}
