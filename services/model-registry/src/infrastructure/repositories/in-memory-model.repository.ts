import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { ModelRepositoryPort } from '../../application/ports/model-repository.port.js';
import {
  CanonicalModel,
  ModelAlias,
  ModelTarget,
  ModelVersion,
  OptimisticLockError,
  RoutingPolicy,
} from '../../domain/index.js';

export class InMemoryModelRepository implements ModelRepositoryPort {
  private readonly models = new Map<CanonicalModelId, CanonicalModel>();

  public async findById(id: CanonicalModelId): Promise<CanonicalModel | null> {
    const model = this.models.get(id);
    if (!model) {
      return null;
    }
    // Return clone to avoid unintentional external reference mutations
    return this.cloneModel(model);
  }

  public async listAll(): Promise<readonly CanonicalModel[]> {
    const list: CanonicalModel[] = [];
    for (const model of this.models.values()) {
      list.push(this.cloneModel(model));
    }
    return Object.freeze(list.sort((a, b) => a.id.localeCompare(b.id)));
  }

  public async save(model: CanonicalModel, expectedVersionLock?: number): Promise<void> {
    const current = this.models.get(model.id);
    if (expectedVersionLock !== undefined && current) {
      if (current.versionLock !== expectedVersionLock) {
        throw new OptimisticLockError(model.id, expectedVersionLock, current.versionLock);
      }
    }

    this.models.set(model.id, this.cloneModel(model));
  }

  public async exists(id: CanonicalModelId): Promise<boolean> {
    return this.models.has(id);
  }

  public clear(): void {
    this.models.clear();
  }

  private cloneModel(model: CanonicalModel): CanonicalModel {
    const versions = model.getVersions().map(
      (v) =>
        new ModelVersion({
          id: v.id,
          canonicalModelId: v.canonicalModelId,
          version: v.version,
          modalities: v.modalities,
          capabilities: v.capabilities,
          limits: v.limits,
          pricing: v.pricing,
          status: v.status,
          isImmutable: v.isImmutable,
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        }),
    );

    const targets = model.getTargets().map(
      (t) =>
        new ModelTarget({
          id: t.id,
          modelVersionId: t.modelVersionId,
          provider: t.provider,
          upstreamModelId: t.upstreamModelId,
          priority: t.priority,
          weight: t.weight,
          region: t.region,
          adapterOptions: t.adapterOptions,
          supportsStreaming: t.supportsStreaming,
          status: t.status,
          maxConcurrency: t.maxConcurrency,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }),
    );

    const routingPolicy = new RoutingPolicy({
      id: model.routingPolicy.id,
      canonicalModelId: model.routingPolicy.canonicalModelId,
      strategy: model.routingPolicy.strategy,
      maxFallbackAttempts: model.routingPolicy.maxFallbackAttempts,
      requireHealthyTarget: model.routingPolicy.requireHealthyTarget,
      degradationBehavior: model.routingPolicy.degradationBehavior,
      createdAt: model.routingPolicy.createdAt,
      updatedAt: model.routingPolicy.updatedAt,
    });

    const aliases = model.getAliases().map(
      (a) =>
        new ModelAlias({
          id: a.id,
          canonicalModelId: a.canonicalModelId,
          aliasName: a.aliasName,
          targetVersion: a.targetVersion,
          tenantId: a.tenantId,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        }),
    );

    return new CanonicalModel({
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      activeVersion: model.activeVersion,
      versionLock: model.versionLock,
      versions,
      targets,
      routingPolicy,
      aliases,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    });
  }
}
