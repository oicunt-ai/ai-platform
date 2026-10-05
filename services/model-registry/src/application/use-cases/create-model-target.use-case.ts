import type { CreateModelTargetDto } from '../dtos/catalog.dto.js';
import type { ModelTargetData } from '../../domain/types.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { AuditRepositoryPort } from '../ports/audit-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import { AuditEvent, ModelNotFoundError, ModelTarget } from '../../domain/index.js';

export class CreateModelTargetUseCase {
  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly auditRepository: AuditRepositoryPort,
    private readonly cache: ModelCachePort,
  ) {}

  public async execute(dto: CreateModelTargetDto): Promise<ModelTargetData> {
    const model = await this.modelRepository.findById(dto.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(dto.canonicalModelId);
    }

    const expectedVersionLock = model.versionLock;
    const target = new ModelTarget({
      id: dto.id,
      modelVersionId: dto.modelVersionId,
      provider: dto.provider,
      upstreamModelId: dto.upstreamModelId,
      priority: dto.priority,
      weight: dto.weight,
      region: dto.region,
      adapterOptions: dto.adapterOptions,
      supportsStreaming: dto.supportsStreaming,
      status: dto.status ?? 'available',
      maxConcurrency: dto.maxConcurrency,
    });

    model.addTarget(target);
    model.incrementVersionLock();

    await this.modelRepository.save(model, expectedVersionLock);

    const auditEvent = new AuditEvent({
      entityType: 'model_target',
      entityId: `${model.id}:${target.id}`,
      action: 'CREATE',
      actorId: dto.actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
      afterState: target.toJSON() as unknown as Record<string, unknown>,
    });

    await this.auditRepository.append(auditEvent);
    await this.cache.invalidateModel(model.id);

    return target.toJSON();
  }
}
