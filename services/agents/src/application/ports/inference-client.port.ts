import type { CanonicalModelId, ReasoningEffortLevel, TokenUsage } from '@oicunt-ai/model-types';
import type { ChatMessage, FinishReason } from '@oicunt-ai/ai-types';

export interface AgentInferenceRequest {
  readonly requestId: string;
  readonly correlationId: string;
  readonly canonicalModelId: CanonicalModelId;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly string[] | undefined;
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly deadlineMs: number;
  readonly tenantId: string;
  readonly actorId: string;
}

export interface AgentInferenceResponse {
  readonly completionId: string;
  readonly message: ChatMessage;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
}

export interface InferenceClientPort {
  execute(
    request: AgentInferenceRequest,
    signal?: AbortSignal | undefined,
  ): Promise<AgentInferenceResponse>;
}
