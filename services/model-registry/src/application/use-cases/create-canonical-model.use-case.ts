import type { CreateCanonicalModelDto, CanonicalModelDetailDto } from '../dtos/catalog.dto.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { AuditRepositoryPort } from '../ports/audit-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import { AuditEvent, CanonicalModel, ModelValidationError } from '../../domain/index.js';

export class CreateCanonicalModelUseCase {
  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly auditRepository: AuditRepositoryPort,
    private readonly cache: ModelCachePort,
  ) {}

  public async execute(dto: CreateCanonicalModelDto): Promise<CanonicalModelDetailDto> {
    const existing = await this.modelRepository.findById(dto.id);
    if (existing) {
      throw new ModelValidationError(
        `Canonical model '${dto.id}' already exists in the catalog`,
        'id',
      );
    }

    const model = new CanonicalModel({
      id: dto.id,
      displayName: dto.displayName,
      description: dto.description,
      activeVersion: dto.activeVersion,
    });

    await this.modelRepository.save(model);

    const auditEvent = new AuditEvent({
      entityType: 'canonical_model',
      entityId: model.id,
      action: 'CREATE',
      actorId: dto.actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
      afterState: model.toJSON() as unknown as Record<string, unknown>,
    });

    await this.auditRepository.append(auditEvent);
    await this.cache.invalidateModel(model.id);

    return {
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      activeVersion: model.activeVersion,
      versionLock: model.versionLock,
      versions: [],
      targets: [],
      routingPolicy: model.routingPolicy.toJSON(),
      aliases: [],
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }
}
