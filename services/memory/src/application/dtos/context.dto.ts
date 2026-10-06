import type { ChatMessage } from '@oicunt-ai/ai-types';

export interface ContextRetrievalRequestDto {
  /**
   * Maximum token budget allocated for conversation history.
   * If omitted, defaults to service configuration (default: 8,192 tokens).
   */
  readonly maxTokens?: number | undefined;

  /**
   * Maximum number of recent messages to return.
   * If omitted, defaults to service configuration (default: 50 messages).
   */
  readonly maxMessages?: number | undefined;

  /**
   * Whether to include the rolling summary if older messages were compacted.
   * Default: true.
   */
  readonly includeSummary?: boolean | undefined;

  /**
   * Sequence number upper bound. Messages with sequenceNumber >= this value are excluded.
   * Useful when re-hydrating context prior to a specific historical turn.
   */
  readonly beforeSequenceNumber?: number | undefined;
}

export interface ContextRetrievalDataDto {
  readonly conversationId: string;

  /**
   * Sequenced chat messages ready for model prompt assembly,
   * sorted in chronological order (sequenceNumber ASC).
   */
  readonly messages: readonly ChatMessage[];

  /**
   * Condensed summary text of older messages pruned from the sliding window,
   * or null if no summary exists or all messages fit within maxTokens.
   */
  readonly summary: string | null;

  /** Total estimated token footprint of the returned messages + summary */
  readonly estimatedTokens: number;

  /** True if older messages exist in the conversation that were omitted due to budget */
  readonly hasMore: boolean;

  /** Total number of messages stored in the full conversation thread */
  readonly totalStoredMessages: number;

  /** Number of messages returned in this context payload */
  readonly returnedMessages: number;

  /** Earliest sequence number included in messages */
  readonly earliestSequenceNumber: number | null;

  /** Latest sequence number included in messages */
  readonly latestSequenceNumber: number | null;
}
