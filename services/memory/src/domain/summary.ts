export interface MemorySummary {
  /** Unique summary identifier (e.g. 'sum_01HZXA4P...') */
  readonly id: string;

  /** Enclosing conversation identifier */
  readonly conversationId: string;

  /** Platform tenant scope */
  readonly tenantId: string;

  /** Sequence number range condensed by this summary (inclusive) */
  readonly sequenceStart: number;
  readonly sequenceEnd: number;

  /** Condensed narrative text capturing key context, decisions, and facts */
  readonly summaryText: string;

  /** Estimated token count of the summaryText */
  readonly tokenEstimate: number;

  /** Summarizer metadata (model used, compaction timestamp) */
  readonly metadata: Record<string, unknown>;

  /** Creation timestamp */
  readonly createdAt: string;
}
