import type { CanonicalModelId, ReasoningEffortLevel } from '@oicunt-ai/model-types';

export interface TurnExecutionContext {
  readonly conversationId?: string | undefined;
  readonly turnId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly actorId: string;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly serviceName?: string | undefined;
  readonly startTime?: number | undefined;
  readonly bypassCache?: boolean | undefined;
}

export interface TurnBudget {
  readonly startTime: number;
  readonly timeoutMs: number;
  readonly deadlineMs: number;
}

export interface ReasoningPrivacyPolicy {
  /**
   * Whether thinking/reasoning data may be exposed to the caller in stream/completion.
   * Default: true
   */
  readonly exposeReasoning?: boolean | undefined;

  /**
   * Whether thinking/reasoning deltas should be redacted from the output stream.
   * If true, 'thinking' events are stripped before reaching the client.
   */
  readonly redactThinking?: boolean | undefined;

  /**
   * Whether thinking content is redacted in structured log outputs.
   */
  readonly redactThinkingInLogs?: boolean | undefined;
}

export interface TurnExecutionMetadata {
  readonly canonicalModelId: CanonicalModelId;
  readonly version: string;
  readonly effort?: ReasoningEffortLevel | undefined;
  readonly turnLatencyMs: number;
  readonly estimatedCostUsd?: number | undefined;
}
