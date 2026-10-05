import type {
  CanonicalModelId,
  ModelInvocationParameters,
  ModelLimits,
  ModelPricing,
  ReasoningEffortLevel,
} from '@oicunt-ai/model-types';
import type { ChatMessage } from '@oicunt-ai/ai-types';
import type { InferenceReasoningPrivacyPolicy } from '../../domain/types.js';

export interface InferenceToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
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
   * Forwarded intact to Model Gateway. Inference does not inspect, validate,
   * reorder, or govern target selection, routing, retries, fallback, or circuit breakers.
   */
  readonly eligibleTargets?: readonly unknown[] | undefined;

  /**
   * Opaque pass-through routing policy from Model Registry for Model Gateway.
   * Forwarded intact to Model Gateway. Gateway remains solely responsible for
   * target selection, routing strategies, retries, fallback, and circuit breakers.
   */
  readonly routingPolicy?: Record<string, unknown> | undefined;

  readonly privacyPolicy?: InferenceReasoningPrivacyPolicy | undefined;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId: string;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly deadlineMs: number;
}
