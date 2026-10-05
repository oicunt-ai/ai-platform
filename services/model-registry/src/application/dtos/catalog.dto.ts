import type {
  CanonicalModelId,
  ModelCapabilities,
  ModelCatalogEntry,
  ModelLimits,
  ModelModality,
  ModelPricing,
  ModelProviderType,
} from '@oicunt-ai/model-types';
import type {
  AvailabilityStatus,
  DegradationBehavior,
  ModelAliasData,
  ModelTargetData,
  ModelVersionData,
  RoutingPolicyData,
  RoutingStrategy,
} from '../../domain/index.js';

export interface CreateCanonicalModelDto {
  readonly id: CanonicalModelId;
  readonly displayName: string;
  readonly description: string;
  readonly family?: string | undefined;
  readonly activeVersion: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly reason?: string | undefined;
}

export interface CreateModelVersionDto {
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly modalities: readonly ModelModality[];
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly status?: AvailabilityStatus | undefined;
  readonly isImmutable?: boolean | undefined;
  readonly actorId: string;
  readonly correlationId: string;
  readonly reason?: string | undefined;
}

export interface UpdateModelVersionStatusDto {
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly status: AvailabilityStatus;
  readonly actorId: string;
  readonly correlationId: string;
  readonly reason?: string | undefined;
}

export interface CreateModelTargetDto {
  readonly id: string;
  readonly canonicalModelId: CanonicalModelId;
  readonly modelVersionId: string;
  readonly provider: ModelProviderType;
  readonly upstreamModelId: string;
  readonly priority?: number | undefined;
  readonly weight?: number | undefined;
  readonly region?: string | undefined;
  readonly adapterOptions?: Record<string, unknown> | undefined;
  readonly supportsStreaming?: boolean | undefined;
  readonly status?: AvailabilityStatus | undefined;
  readonly maxConcurrency?: number | undefined;
  readonly actorId: string;
  readonly correlationId: string;
  readonly reason?: string | undefined;
}

export interface UpdateModelTargetStatusDto {
  readonly canonicalModelId: CanonicalModelId;
  readonly targetId: string;
  readonly status: AvailabilityStatus;
  readonly actorId: string;
  readonly correlationId: string;
  readonly reason?: string | undefined;
}

export interface UpdateRoutingPolicyDto {
  readonly canonicalModelId: CanonicalModelId;
  readonly strategy?: RoutingStrategy | undefined;
  readonly maxFallbackAttempts?: number | undefined;
  readonly requireHealthyTarget?: boolean | undefined;
  readonly degradationBehavior?: DegradationBehavior | undefined;
  readonly actorId: string;
  readonly correlationId: string;
  readonly reason?: string | undefined;
}

export interface SetModelAliasDto {
  readonly canonicalModelId: CanonicalModelId;
  readonly aliasName: string;
  readonly targetVersion: string;
  readonly tenantId?: string | undefined;
  readonly actorId: string;
  readonly correlationId: string;
  readonly reason?: string | undefined;
}

export interface CanonicalModelSummaryDto {
  readonly id: CanonicalModelId;
  readonly displayName: string;
  readonly description: string;
  readonly family?: string | undefined;
  readonly activeVersion: string;
  readonly versionsCount: number;
  readonly targetsCount: number;
}

export interface CanonicalModelDetailDto {
  readonly id: CanonicalModelId;
  readonly displayName: string;
  readonly description: string;
  readonly family?: string | undefined;
  readonly activeVersion: string;
  readonly versionLock: number;
  readonly versions: readonly ModelVersionData[];
  readonly targets: readonly ModelTargetData[];
  readonly routingPolicy: RoutingPolicyData;
  readonly aliases: readonly ModelAliasData[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * User-facing model catalog item exposed to BILLY and client selectors.
 */
export type ModelCatalogEntryDto = ModelCatalogEntry;
