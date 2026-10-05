export interface InferenceExecutionContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly actorId: string;
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly serviceName?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly startTime?: number | undefined;
}

export interface InferenceReasoningPrivacyPolicy {
  /**
   * Whether thinking/reasoning data may be exposed to the caller in stream/completion.
   * Default: true
   */
  readonly exposeReasoning?: boolean | undefined;

  /**
   * Whether thinking/reasoning deltas should be redacted from the output stream.
   * If true, 'thinking' events are stripped before reaching the client.
   * Default: false
   */
  readonly redactThinking?: boolean | undefined;

  /**
   * Whether thinking content is redacted in structured log outputs.
   * Default: true
   */
  readonly redactThinkingInLogs?: boolean | undefined;
}

export interface InferenceExecutionMetadata {
  /** Time from request receipt to completion generation (ms) */
  readonly latencyMs: number;

  /** Time to first token in milliseconds (if applicable) */
  readonly ttftMs?: number | undefined;

  /** Generation rate in tokens per second */
  readonly tokensPerSecond?: number | undefined;

  /** Estimated cost in USD calculated from pricing tables */
  readonly estimatedCostUsd?: number | undefined;
}
