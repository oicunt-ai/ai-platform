import type {
  CanonicalModelId,
  ModelCapabilities,
  ModelLimits,
  ModelModality,
  ModelPricing,
  ModelProviderType,
  ReasoningEffortLevel,
} from '@oicunt-ai/model-types';

export interface ModelResolutionQuery {
  readonly canonicalModelId: CanonicalModelId;
  readonly version?: string | undefined;
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly tenantId?: string | undefined;
  readonly correlationId: string;
}

export interface ResolvedTargetDto {
  readonly targetId: string;
  readonly provider: ModelProviderType;
  readonly upstreamModelId: string;
  readonly priority: number;
  readonly weight: number;
  readonly region?: string | undefined;
  readonly adapterOptions?: Record<string, unknown> | undefined;
  readonly supportsStreaming: boolean;
  readonly maxConcurrency?: number | undefined;
}

export interface RoutingPolicyConfigDto {
  readonly strategy: 'priority-fallback' | 'weighted-round-robin' | 'lowest-latency';
  readonly maxFallbackAttempts: number;
  readonly requireHealthyTarget: boolean;
  readonly degradationBehavior: 'fail-fast' | 'fallback-to-fast' | 'queue';
}

export interface ModelResolutionResult {
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly family?: string | undefined;
  readonly modalities: readonly ModelModality[];
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly status: 'available' | 'degraded' | 'maintenance' | 'deprecated';
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly eligibleTargets: readonly ResolvedTargetDto[];
  readonly routingPolicy: RoutingPolicyConfigDto;
  readonly resolvedAt: string;
}
