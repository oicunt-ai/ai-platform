import type { CanonicalModelId, ReasoningEffortLevel, TokenUsage } from '@oicunt-ai/model-types';
import type { ChatMessage, FinishReason } from '@oicunt-ai/ai-types';
import type { InferenceExecutionMetadata } from '../../domain/types.js';

export interface InferenceResultData {
  readonly completionId: string;
  readonly model: CanonicalModelId;
  readonly version: string;
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly message: ChatMessage;
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
  readonly metadata: InferenceExecutionMetadata;
}

export interface InferenceExecutionResponse {
  readonly success: true;
  readonly data: InferenceResultData;
  readonly meta: {
    readonly requestId: string;
    readonly correlationId: string;
    readonly timestamp: string;
  };
}
