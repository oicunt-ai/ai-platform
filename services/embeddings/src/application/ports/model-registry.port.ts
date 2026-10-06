import type {
  CanonicalModelId,
  ModelCapabilities,
  ModelLimits,
  ModelModality,
  ModelPricing,
  ModelProviderType,
} from '@oicunt-ai/model-types';

export interface ResolvedTargetDto {
  readonly targetId: string;
  readonly provider: ModelProviderType;
  readonly upstreamModelId: string;
  readonly priority: number;
  readonly weight: number;
  readonly region?: string | undefined;
  readonly adapterOptions?: Record<string, unknown> | undefined;
  readonly supportsStreaming?: boolean | undefined;
  readonly maxConcurrency?: number | undefined;
}

export interface RoutingPolicyConfigDto {
  readonly strategy: string;
  readonly maxFallbackAttempts: number;
  readonly requireHealthyTarget?: boolean | undefined;
  readonly degradationBehavior?: string | undefined;
}

export interface ModelResolutionQuery {
  readonly canonicalModelId: CanonicalModelId | string;
  readonly version?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly correlationId: string;
}

export interface ModelResolutionResult {
  readonly canonicalModelId: CanonicalModelId | string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly modalities: readonly ModelModality[];
  readonly capabilities: ModelCapabilities;
  readonly limits: ModelLimits;
  readonly pricing?: ModelPricing | undefined;
  readonly status: 'available' | 'degraded' | 'maintenance' | 'deprecated';
  readonly eligibleTargets: readonly ResolvedTargetDto[];
  readonly routingPolicy?: RoutingPolicyConfigDto | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly resolvedAt: string;
}

export interface ModelRegistryPort {
  /**
   * Resolves canonical model identity, capabilities, context limits, and eligible provider targets.
   */
  resolveModel(
    query: ModelResolutionQuery,
    signal?: AbortSignal | undefined,
  ): Promise<ModelResolutionResult>;

  /**
   * Probes reachability and health of the Model Registry.
   */
  checkHealth(signal?: AbortSignal | undefined): Promise<boolean>;
}
