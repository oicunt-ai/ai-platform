import type {
  CanonicalModelId,
  ModelInvocationParameters,
  ModelLimits,
  ModelPricing,
  ReasoningEffortLevel,
} from '@oicunt-ai/model-types';
import type { ChatMessage, NormalizedCompletionData, StreamEvent } from '@oicunt-ai/ai-types';

export interface GatewayToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
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
  readonly pricing?: ModelPricing | undefined;
  readonly eligibleTargets?: readonly unknown[] | undefined;
  readonly routingPolicy?: Record<string, unknown> | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly deadlineMs?: number | undefined;
  readonly exposeReasoning?: boolean | undefined;
}

export interface ModelGatewayPort {
  dispatchUnary(
    payload: GatewayDispatchPayload,
    signal?: AbortSignal,
  ): Promise<NormalizedCompletionData>;

  dispatchStream(payload: GatewayDispatchPayload, signal?: AbortSignal): AsyncIterable<StreamEvent>;

  checkHealth(signal?: AbortSignal): Promise<boolean>;
}
