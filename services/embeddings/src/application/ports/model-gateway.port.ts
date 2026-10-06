import type { ResolvedTargetDto, RoutingPolicyConfigDto } from './model-registry.port.js';

export interface EmbeddingDispatchPayload {
  readonly requestId: string;
  readonly correlationId: string;
  readonly canonicalModelId: string;
  readonly version: string;
  readonly inputs: readonly string[];
  readonly dimensions: number;
  readonly eligibleTargets: readonly ResolvedTargetDto[];
  readonly routingPolicy?: RoutingPolicyConfigDto | undefined;
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface EmbeddingDispatchResult {
  readonly vectors: readonly (readonly number[])[];
  readonly usage: {
    readonly promptTokens: number;
    readonly totalTokens: number;
  };
  readonly targetUsed?: string | undefined;
  readonly providerUsed?: string | undefined;
}

export interface ModelGatewayPort {
  /**
   * Dispatches an atomic batch of input texts to the Model Gateway provider execution boundary.
   */
  dispatchEmbeddings(
    payload: EmbeddingDispatchPayload,
    signal?: AbortSignal | undefined,
  ): Promise<EmbeddingDispatchResult>;

  /**
   * Probes reachability and health of the Model Gateway.
   */
  checkHealth(signal?: AbortSignal | undefined): Promise<boolean>;
}
