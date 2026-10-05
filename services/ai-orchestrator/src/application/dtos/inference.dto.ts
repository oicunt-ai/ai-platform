import type {
  CanonicalModelId,
  ModelInvocationParameters,
  ModelLimits,
  ModelPricing,
  ReasoningEffortLevel,
  TokenUsage,
} from '@oicunt-ai/model-types';
import type { ChatMessage, FinishReason } from '@oicunt-ai/ai-types';
import type { ResolvedTargetDto, RoutingPolicyConfigDto } from './resolution.dto.js';

export interface InferenceToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface InferenceReasoningPrivacyPolicy {
  readonly exposeReasoning?: boolean | undefined;
  readonly redactThinking?: boolean | undefined;
  readonly redactThinkingInLogs?: boolean | undefined;
}

export interface InferenceExecutionRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly conversationId?: string | undefined;
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly messages: readonly ChatMessage[];
  readonly parameters?: ModelInvocationParameters | undefined;
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly tools?: readonly InferenceToolDefinition[] | undefined;
  readonly stream: boolean;
  readonly limits: ModelLimits;
  readonly pricing?: ModelPricing | undefined;

  /**
   * Opaque pass-through execution targets resolved by Model Registry for Model Gateway.
   * Forwarded intact to Inference Service which forwards to Model Gateway.
   */
  readonly eligibleTargets?: readonly ResolvedTargetDto[] | undefined;

  /**
   * Opaque pass-through routing policy from Model Registry for Model Gateway.
   * Forwarded intact to Inference Service which forwards to Model Gateway.
   */
  readonly routingPolicy?: RoutingPolicyConfigDto | Record<string, unknown> | undefined;

  readonly privacyPolicy?: InferenceReasoningPrivacyPolicy | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly deadlineMs: number;
}

export interface InferenceResultData {
  readonly completionId: string;
  readonly model: CanonicalModelId;
  readonly version: string;
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly message: ChatMessage;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface InferenceExecutionResponse {
  readonly success: true;
  readonly data: InferenceResultData;
  readonly meta?: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly timestamp: string;
  };
}
