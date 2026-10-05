import type { UpdateRoutingPolicyDto } from '../dtos/catalog.dto.js';
import type { RoutingPolicyData } from '../../domain/types.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { AuditRepositoryPort } from '../ports/audit-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import { AuditEvent, ModelNotFoundError, RoutingPolicy } from '../../domain/index.js';

export class UpdateRoutingPolicyUseCase {
  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly auditRepository: AuditRepositoryPort,
    private readonly cache: ModelCachePort,
  ) {}

  public async execute(dto: UpdateRoutingPolicyDto): Promise<RoutingPolicyData> {
    const model = await this.modelRepository.findById(dto.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(dto.canonicalModelId);
    }

    const beforeState = model.routingPolicy.toJSON() as unknown as Record<string, unknown>;
    const expectedVersionLock = model.versionLock;

    const newPolicy = new RoutingPolicy({
      id: model.routingPolicy.id,
      canonicalModelId: model.id,
      strategy: dto.strategy ?? model.routingPolicy.strategy,
      maxFallbackAttempts: dto.maxFallbackAttempts ?? model.routingPolicy.maxFallbackAttempts,
      requireHealthyTarget: dto.requireHealthyTarget ?? model.routingPolicy.requireHealthyTarget,
      degradationBehavior: dto.degradationBehavior ?? model.routingPolicy.degradationBehavior,
    });

    model.updateRoutingPolicy(newPolicy);
    model.incrementVersionLock();

    await this.modelRepository.save(model, expectedVersionLock);

    const auditEvent = new AuditEvent({
      entityType: 'routing_policy',
      entityId: `${model.id}:${newPolicy.id}`,
      action: 'UPDATE',
      actorId: dto.actorId,
      correlationId: dto.correlationId,
      reason: dto.reason,
      beforeState,
      afterState: newPolicy.toJSON() as unknown as Record<string, unknown>,
    });

    await this.auditRepository.append(auditEvent);
    await this.cache.invalidateModel(model.id);

    return newPolicy.toJSON();
  }
}
