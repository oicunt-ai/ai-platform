import type {
  CanonicalModelId,
  ModelCapabilities,
  ModelLimits,
  ModelModality,
  ModelPricing,
  ModelProviderType,
} from '@oicunt-ai/model-types';

/**
 * Operational availability status for canonical models, versions, and targets.
 */
export type AvailabilityStatus = 'available' | 'degraded' | 'maintenance' | 'deprecated';

/**
 * Traffic dispatch and failover routing strategies.
 */
export type RoutingStrategy = 'priority-fallback' | 'weighted-round-robin' | 'lowest-latency';

/**
 * Posture when preferred targets are degraded or unavailable.
 */
export type DegradationBehavior = 'fail-fast' | 'fallback-to-fast' | 'queue';

/**
 * Entity types tracked in the Model Registry audit log.
 */
export type AuditEntityType =
  'canonical_model' | 'model_version' | 'model_target' | 'model_alias' | 'routing_policy';

/**
 * Audit actions recorded for mutations.
 */
export type AuditAction = 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'DELETE' | 'DEPRECATE';

/**
 * Normalized model target configuration.
 */
export interface ModelTargetData {
  readonly id: string;
  readonly modelVersionId: string;
  readonly provider: ModelProviderType;
  readonly upstreamModelId: string;
  readonly priority: number;
  readonly weight: number;
  readonly region?: string | undefined;
  readonly adapterOptions?: Record<string, unknown> | undefined;
  readonly supportsStreaming: boolean;
  readonly status: AvailabilityStatus;
  readonly maxConcurrency?: number | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Model version record snapshot.
 */
export interface ModelVersionData {
  readonly id: string;
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly modalities: readonly ModelModality[];
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly status: AvailabilityStatus;
  readonly isImmutable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Routing policy configuration.
 */
export interface RoutingPolicyData {
  readonly id: string;
  readonly canonicalModelId: CanonicalModelId;
  readonly strategy: RoutingStrategy;
  readonly maxFallbackAttempts: number;
  readonly requireHealthyTarget: boolean;
  readonly degradationBehavior: DegradationBehavior;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Model alias mapping.
 */
export interface ModelAliasData {
  readonly id: string;
  readonly canonicalModelId: CanonicalModelId;
  readonly aliasName: string;
  readonly targetVersion: string;
  readonly tenantId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Canonical model master record.
 */
export interface CanonicalModelData {
  readonly id: CanonicalModelId;
  readonly displayName: string;
  readonly description: string;
  readonly activeVersion: string;
  readonly versionLock: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
