import type { CanonicalModelId, ModelModality } from '@oicunt-ai/model-types';
import type { ModelRepositoryPort } from '../../application/ports/model-repository.port.js';
import {
  CanonicalModel,
  ModelAlias,
  ModelTarget,
  ModelVersion,
  OptimisticLockError,
  RoutingPolicy,
} from '../../domain/index.js';
import type { DatabasePool } from '../database/connection.js';

interface CanonicalModelRow {
  id: string;
  display_name: string;
  description: string;
  active_version: string;
  version_lock: number;
  created_at: Date;
  updated_at: Date;
}

interface ModelVersionRow {
  id: string;
  canonical_model_id: string;
  version: string;
  modalities: string[];
  capabilities: Record<string, unknown>;
  limits: Record<string, unknown>;
  pricing: Record<string, unknown>;
  status: string;
  is_immutable: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ModelTargetRow {
  id: string;
  model_version_id: string;
  provider: string;
  upstream_model_id: string;
  priority: number;
  weight: number;
  region: string | null;
  adapter_options: Record<string, unknown> | null;
  supports_streaming: boolean;
  status: string;
  max_concurrency: number | null;
  created_at: Date;
  updated_at: Date;
}

interface RoutingPolicyRow {
  id: string;
  canonical_model_id: string;
  strategy: string;
  max_fallback_attempts: number;
  require_healthy_target: boolean;
  degradation_behavior: string;
  created_at: Date;
  updated_at: Date;
}

interface ModelAliasRow {
  id: string;
  canonical_model_id: string;
  alias_name: string;
  target_version: string;
  tenant_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class PostgresModelRepository implements ModelRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async findById(id: CanonicalModelId): Promise<CanonicalModel | null> {
    const modelRes = await this.db.query<CanonicalModelRow>(
      'SELECT * FROM model_registry.canonical_models WHERE id = $1',
      [id],
    );

    if (modelRes.rows.length === 0 || !modelRes.rows[0]) {
      return null;
    }

    const modelRow = modelRes.rows[0];

    // Load versions
    const versionsRes = await this.db.query<ModelVersionRow>(
      'SELECT * FROM model_registry.model_versions WHERE canonical_model_id = $1 ORDER BY created_at ASC',
      [id],
    );

    const versionEntities: ModelVersion[] = [];
    const versionIdList: string[] = [];

    for (const vRow of versionsRes.rows) {
      versionIdList.push(vRow.id);
      versionEntities.push(
        new ModelVersion({
          id: vRow.id,
          canonicalModelId: vRow.canonical_model_id as CanonicalModelId,
          version: vRow.version,
          modalities: vRow.modalities as readonly ModelModality[],
          capabilities: vRow.capabilities as unknown as ModelVersion['capabilities'],
          limits: vRow.limits as unknown as ModelVersion['limits'],
          pricing: vRow.pricing as unknown as ModelVersion['pricing'],
          status: vRow.status as ModelVersion['status'],
          isImmutable: vRow.is_immutable,
          createdAt: vRow.created_at.toISOString(),
          updatedAt: vRow.updated_at.toISOString(),
        }),
      );
    }

    // Load targets
    const targetEntities: ModelTarget[] = [];
    if (versionIdList.length > 0) {
      const targetsRes = await this.db.query<ModelTargetRow>(
        'SELECT * FROM model_registry.model_targets WHERE model_version_id = ANY($1::uuid[]) ORDER BY priority ASC, weight DESC',
        [versionIdList],
      );

      for (const tRow of targetsRes.rows) {
        targetEntities.push(
          new ModelTarget({
            id: tRow.id,
            modelVersionId: tRow.model_version_id,
            provider: tRow.provider as ModelTarget['provider'],
            upstreamModelId: tRow.upstream_model_id,
            priority: tRow.priority,
            weight: tRow.weight,
            region: tRow.region ?? undefined,
            adapterOptions: tRow.adapter_options ?? undefined,
            supportsStreaming: tRow.supports_streaming,
            status: tRow.status as ModelTarget['status'],
            maxConcurrency: tRow.max_concurrency ?? undefined,
            createdAt: tRow.created_at.toISOString(),
            updatedAt: tRow.updated_at.toISOString(),
          }),
        );
      }
    }

    // Load routing policy
    const policyRes = await this.db.query<RoutingPolicyRow>(
      'SELECT * FROM model_registry.routing_policies WHERE canonical_model_id = $1',
      [id],
    );

    let routingPolicy: RoutingPolicy | undefined;
    if (policyRes.rows.length > 0 && policyRes.rows[0]) {
      const pRow = policyRes.rows[0];
      routingPolicy = new RoutingPolicy({
        id: pRow.id,
        canonicalModelId: pRow.canonical_model_id as CanonicalModelId,
        strategy: pRow.strategy as RoutingPolicy['strategy'],
        maxFallbackAttempts: pRow.max_fallback_attempts,
        requireHealthyTarget: pRow.require_healthy_target,
        degradationBehavior: pRow.degradation_behavior as RoutingPolicy['degradationBehavior'],
        createdAt: pRow.created_at.toISOString(),
        updatedAt: pRow.updated_at.toISOString(),
      });
    }

    // Load aliases
    const aliasesRes = await this.db.query<ModelAliasRow>(
      'SELECT * FROM model_registry.model_aliases WHERE canonical_model_id = $1',
      [id],
    );

    const aliasEntities: ModelAlias[] = aliasesRes.rows.map(
      (aRow) =>
        new ModelAlias({
          id: aRow.id,
          canonicalModelId: aRow.canonical_model_id as CanonicalModelId,
          aliasName: aRow.alias_name,
          targetVersion: aRow.target_version,
          tenantId: aRow.tenant_id ?? undefined,
          createdAt: aRow.created_at.toISOString(),
          updatedAt: aRow.updated_at.toISOString(),
        }),
    );

    return new CanonicalModel({
      id: modelRow.id as CanonicalModelId,
      displayName: modelRow.display_name,
      description: modelRow.description,
      activeVersion: modelRow.active_version,
      versionLock: modelRow.version_lock,
      versions: versionEntities,
      targets: targetEntities,
      routingPolicy,
      aliases: aliasEntities,
      createdAt: modelRow.created_at.toISOString(),
      updatedAt: modelRow.updated_at.toISOString(),
    });
  }

  /**
   * Loads all CanonicalModel aggregates using 5 batch queries to prevent the N+1 query pattern.
   */
  public async listAll(): Promise<readonly CanonicalModel[]> {
    const modelsRes = await this.db.query<CanonicalModelRow>(
      'SELECT * FROM model_registry.canonical_models ORDER BY id ASC',
    );

    if (modelsRes.rows.length === 0) {
      return Object.freeze([]);
    }

    const modelIds = modelsRes.rows.map((r) => r.id);

    // 1. Batch load all versions
    const versionsRes = await this.db.query<ModelVersionRow>(
      'SELECT * FROM model_registry.model_versions WHERE canonical_model_id = ANY($1::varchar[]) ORDER BY created_at ASC',
      [modelIds],
    );

    const versionEntitiesByModelId = new Map<string, ModelVersion[]>();
    const versionIdList: string[] = [];

    for (const vRow of versionsRes.rows) {
      versionIdList.push(vRow.id);
      const vEntity = new ModelVersion({
        id: vRow.id,
        canonicalModelId: vRow.canonical_model_id as CanonicalModelId,
        version: vRow.version,
        modalities: vRow.modalities as readonly ModelModality[],
        capabilities: vRow.capabilities as unknown as ModelVersion['capabilities'],
        limits: vRow.limits as unknown as ModelVersion['limits'],
        pricing: vRow.pricing as unknown as ModelVersion['pricing'],
        status: vRow.status as ModelVersion['status'],
        isImmutable: vRow.is_immutable,
        createdAt: vRow.created_at.toISOString(),
        updatedAt: vRow.updated_at.toISOString(),
      });

      let list = versionEntitiesByModelId.get(vRow.canonical_model_id);
      if (!list) {
        list = [];
        versionEntitiesByModelId.set(vRow.canonical_model_id, list);
      }
      list.push(vEntity);
    }

    // 2. Batch load all targets
    const targetEntitiesByVersionId = new Map<string, ModelTarget[]>();
    if (versionIdList.length > 0) {
      const targetsRes = await this.db.query<ModelTargetRow>(
        'SELECT * FROM model_registry.model_targets WHERE model_version_id = ANY($1::uuid[]) ORDER BY priority ASC, weight DESC',
        [versionIdList],
      );

      for (const tRow of targetsRes.rows) {
        const tEntity = new ModelTarget({
          id: tRow.id,
          modelVersionId: tRow.model_version_id,
          provider: tRow.provider as ModelTarget['provider'],
          upstreamModelId: tRow.upstream_model_id,
          priority: tRow.priority,
          weight: tRow.weight,
          region: tRow.region ?? undefined,
          adapterOptions: tRow.adapter_options ?? undefined,
          supportsStreaming: tRow.supports_streaming,
          status: tRow.status as ModelTarget['status'],
          maxConcurrency: tRow.max_concurrency ?? undefined,
          createdAt: tRow.created_at.toISOString(),
          updatedAt: tRow.updated_at.toISOString(),
        });

        let list = targetEntitiesByVersionId.get(tRow.model_version_id);
        if (!list) {
          list = [];
          targetEntitiesByVersionId.set(tRow.model_version_id, list);
        }
        list.push(tEntity);
      }
    }

    // 3. Batch load routing policies
    const policiesRes = await this.db.query<RoutingPolicyRow>(
      'SELECT * FROM model_registry.routing_policies WHERE canonical_model_id = ANY($1::varchar[])',
      [modelIds],
    );

    const policiesByModelId = new Map<string, RoutingPolicy>();
    for (const pRow of policiesRes.rows) {
      policiesByModelId.set(
        pRow.canonical_model_id,
        new RoutingPolicy({
          id: pRow.id,
          canonicalModelId: pRow.canonical_model_id as CanonicalModelId,
          strategy: pRow.strategy as RoutingPolicy['strategy'],
          maxFallbackAttempts: pRow.max_fallback_attempts,
          requireHealthyTarget: pRow.require_healthy_target,
          degradationBehavior: pRow.degradation_behavior as RoutingPolicy['degradationBehavior'],
          createdAt: pRow.created_at.toISOString(),
          updatedAt: pRow.updated_at.toISOString(),
        }),
      );
    }

    // 4. Batch load aliases
    const aliasesRes = await this.db.query<ModelAliasRow>(
      'SELECT * FROM model_registry.model_aliases WHERE canonical_model_id = ANY($1::varchar[])',
      [modelIds],
    );

    const aliasesByModelId = new Map<string, ModelAlias[]>();
    for (const aRow of aliasesRes.rows) {
      const aEntity = new ModelAlias({
        id: aRow.id,
        canonicalModelId: aRow.canonical_model_id as CanonicalModelId,
        aliasName: aRow.alias_name,
        targetVersion: aRow.target_version,
        tenantId: aRow.tenant_id ?? undefined,
        createdAt: aRow.created_at.toISOString(),
        updatedAt: aRow.updated_at.toISOString(),
      });

      let list = aliasesByModelId.get(aRow.canonical_model_id);
      if (!list) {
        list = [];
        aliasesByModelId.set(aRow.canonical_model_id, list);
      }
      list.push(aEntity);
    }

    // Assemble CanonicalModel aggregates
    const results: CanonicalModel[] = [];
    for (const mRow of modelsRes.rows) {
      const versions = versionEntitiesByModelId.get(mRow.id) ?? [];
      const targets: ModelTarget[] = [];
      for (const v of versions) {
        const vTargets = targetEntitiesByVersionId.get(v.id) ?? [];
        targets.push(...vTargets);
      }
      const routingPolicy = policiesByModelId.get(mRow.id);
      const aliases = aliasesByModelId.get(mRow.id) ?? [];

      results.push(
        new CanonicalModel({
          id: mRow.id as CanonicalModelId,
          displayName: mRow.display_name,
          description: mRow.description,
          activeVersion: mRow.active_version,
          versionLock: mRow.version_lock,
          versions,
          targets,
          routingPolicy,
          aliases,
          createdAt: mRow.created_at.toISOString(),
          updatedAt: mRow.updated_at.toISOString(),
        }),
      );
    }

    return Object.freeze(results);
  }

  public async save(model: CanonicalModel, expectedVersionLock?: number): Promise<void> {
    await this.db.withTransaction(async (client) => {
      // 1. Optimistic Concurrency Lock Check
      if (expectedVersionLock !== undefined) {
        const currentLockRes = await client.query<{ version_lock: number }>(
          'SELECT version_lock FROM model_registry.canonical_models WHERE id = $1 FOR UPDATE',
          [model.id],
        );

        if (currentLockRes.rows.length > 0 && currentLockRes.rows[0]) {
          const actualLock = currentLockRes.rows[0].version_lock;
          if (actualLock !== expectedVersionLock) {
            throw new OptimisticLockError(model.id, expectedVersionLock, actualLock);
          }
        }
      }

      // 2. Upsert Canonical Model
      await client.query(
        `INSERT INTO model_registry.canonical_models (id, display_name, description, active_version, version_lock, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            description = EXCLUDED.description,
            active_version = EXCLUDED.active_version,
            version_lock = EXCLUDED.version_lock,
            updated_at = NOW()`,
        [model.id, model.displayName, model.description, model.activeVersion, model.versionLock],
      );

      // 3. Upsert Versions & Prune Removed (Orphaned) Versions
      const currentVersions = model.getVersions();
      const currentVersionIds = currentVersions.map((v) => v.id);

      if (currentVersionIds.length > 0) {
        await client.query(
          'DELETE FROM model_registry.model_versions WHERE canonical_model_id = $1 AND NOT (id = ANY($2::uuid[]))',
          [model.id, currentVersionIds],
        );
      } else {
        await client.query(
          'DELETE FROM model_registry.model_versions WHERE canonical_model_id = $1',
          [model.id],
        );
      }

      for (const v of currentVersions) {
        await client.query(
          `INSERT INTO model_registry.model_versions
            (id, canonical_model_id, version, modalities, capabilities, limits, pricing, status, is_immutable, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (canonical_model_id, version) DO UPDATE SET
            status = EXCLUDED.status,
            updated_at = NOW()`,
          [
            v.id,
            v.canonicalModelId,
            v.version,
            v.modalities,
            JSON.stringify(v.capabilities),
            JSON.stringify(v.limits),
            JSON.stringify(v.pricing),
            v.status,
            v.isImmutable,
          ],
        );
      }

      // 4. Upsert Targets & Prune Removed (Orphaned) Targets
      const currentTargets = model.getTargets();
      const currentTargetIds = currentTargets.map((t) => t.id);

      if (currentVersionIds.length > 0) {
        if (currentTargetIds.length > 0) {
          await client.query(
            'DELETE FROM model_registry.model_targets WHERE model_version_id = ANY($1::uuid[]) AND NOT (id = ANY($2::varchar[]))',
            [currentVersionIds, currentTargetIds],
          );
        } else {
          await client.query(
            'DELETE FROM model_registry.model_targets WHERE model_version_id = ANY($1::uuid[])',
            [currentVersionIds],
          );
        }
      }

      for (const t of currentTargets) {
        await client.query(
          `INSERT INTO model_registry.model_targets
            (id, model_version_id, provider, upstream_model_id, priority, weight, region, adapter_options, supports_streaming, status, max_concurrency, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
           ON CONFLICT (id) DO UPDATE SET
            priority = EXCLUDED.priority,
            weight = EXCLUDED.weight,
            region = EXCLUDED.region,
            adapter_options = EXCLUDED.adapter_options,
            supports_streaming = EXCLUDED.supports_streaming,
            status = EXCLUDED.status,
            max_concurrency = EXCLUDED.max_concurrency,
            updated_at = NOW()`,
          [
            t.id,
            t.modelVersionId,
            t.provider,
            t.upstreamModelId,
            t.priority,
            t.weight,
            t.region ?? null,
            t.adapterOptions ? JSON.stringify(t.adapterOptions) : null,
            t.supportsStreaming,
            t.status,
            t.maxConcurrency ?? null,
          ],
        );
      }

      // 5. Upsert Routing Policy
      const p = model.routingPolicy;
      await client.query(
        `INSERT INTO model_registry.routing_policies
          (id, canonical_model_id, strategy, max_fallback_attempts, require_healthy_target, degradation_behavior, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (canonical_model_id) DO UPDATE SET
          strategy = EXCLUDED.strategy,
          max_fallback_attempts = EXCLUDED.max_fallback_attempts,
          require_healthy_target = EXCLUDED.require_healthy_target,
          degradation_behavior = EXCLUDED.degradation_behavior,
          updated_at = NOW()`,
        [
          p.id,
          p.canonicalModelId,
          p.strategy,
          p.maxFallbackAttempts,
          p.requireHealthyTarget,
          p.degradationBehavior,
        ],
      );

      // 6. Upsert Aliases & Prune Removed (Orphaned) Aliases
      const currentAliases = model.getAliases();
      const currentAliasIds = currentAliases.map((a) => a.id);

      if (currentAliasIds.length > 0) {
        await client.query(
          'DELETE FROM model_registry.model_aliases WHERE canonical_model_id = $1 AND NOT (id = ANY($2::uuid[]))',
          [model.id, currentAliasIds],
        );
      } else {
        await client.query(
          'DELETE FROM model_registry.model_aliases WHERE canonical_model_id = $1',
          [model.id],
        );
      }

      for (const a of currentAliases) {
        if (a.tenantId) {
          // Tenant-specific alias: matches partial unique index idx_uq_model_alias_tenant
          await client.query(
            `INSERT INTO model_registry.model_aliases
              (id, canonical_model_id, alias_name, target_version, tenant_id, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (canonical_model_id, alias_name, tenant_id) WHERE tenant_id IS NOT NULL DO UPDATE SET
              target_version = EXCLUDED.target_version,
              updated_at = NOW()`,
            [a.id, a.canonicalModelId, a.aliasName, a.targetVersion, a.tenantId],
          );
        } else {
          // Global alias: matches partial unique index idx_uq_model_alias_global
          await client.query(
            `INSERT INTO model_registry.model_aliases
              (id, canonical_model_id, alias_name, target_version, tenant_id, updated_at)
             VALUES ($1, $2, $3, $4, NULL, NOW())
             ON CONFLICT (canonical_model_id, alias_name) WHERE tenant_id IS NULL DO UPDATE SET
              target_version = EXCLUDED.target_version,
              updated_at = NOW()`,
            [a.id, a.canonicalModelId, a.aliasName, a.targetVersion],
          );
        }
      }
    });
  }

  public async exists(id: CanonicalModelId): Promise<boolean> {
    const res = await this.db.query(
      'SELECT 1 FROM model_registry.canonical_models WHERE id = $1 LIMIT 1',
      [id],
    );
    return res.rowCount !== null && res.rowCount > 0;
  }
}
