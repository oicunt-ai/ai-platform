import type {
  CanonicalModelId,
  ModelInvocationParameters,
  ModelLimits,
  ModelPricing,
  ReasoningEffortLevel,
} from '@oicunt-ai/model-types';
import type { ChatMessage } from '@oicunt-ai/ai-types';

export interface GatewayToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ResolvedTargetDto {
  readonly targetId: string;
  readonly provider:
    'anthropic' | 'openai' | 'google' | 'bedrock' | 'azure-openai' | 'local' | 'custom';
  readonly upstreamModelId: string;
  readonly priority: number;
  readonly weight: number;
  readonly region?: string | undefined;
  readonly adapterOptions?: Record<string, unknown> | undefined;
  readonly supportsStreaming: boolean;
  readonly maxConcurrency?: number | undefined;
}

export interface GatewayRoutingPolicyDto {
  readonly strategy: 'priority-fallback' | 'weighted-round-robin' | 'lowest-latency';
  readonly maxFallbackAttempts: number;
  readonly requireHealthyTarget: boolean;
  readonly degradationBehavior: 'fail-fast' | 'fallback-to-fast' | 'queue';
}

export interface GatewayDispatchPayload {
  readonly requestId: string;
  readonly correlationId: string;
  readonly conversationId?: string | undefined;
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly messages: readonly ChatMessage[];
  readonly parameters?: ModelInvocationParameters | undefined;
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly tools?: readonly GatewayToolDefinition[] | undefined;
  readonly stream: boolean;
  readonly limits: ModelLimits;
  readonly pricing: ModelPricing;
  readonly eligibleTargets: readonly ResolvedTargetDto[];
  readonly routingPolicy: GatewayRoutingPolicyDto;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly deadlineMs?: number | undefined;
  /** Whether reasoning/thinking data may be exposed to caller in stream/completion */
  readonly exposeReasoning?: boolean | undefined;
}
