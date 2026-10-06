export type ConversationStatus = 'active' | 'archived' | 'deleted';

export interface ListConversationsQuery {
  readonly userId?: string | undefined;
  readonly status?: ConversationStatus | 'all' | undefined;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
  readonly order?: 'asc' | 'desc' | undefined;
}

export interface ListMessagesQuery {
  /** Cursor: sequenceNumber to paginate after (forward pagination) */
  readonly afterSequence?: number | undefined;

  /** Cursor: sequenceNumber to paginate before (backward pagination) */
  readonly beforeSequence?: number | undefined;

  /** Number of messages to return (default: 50, max: 100) */
  readonly limit?: number | undefined;

  /** Sort direction: 'asc' (chronological) or 'desc' (reverse chronological) */
  readonly order?: 'asc' | 'desc' | undefined;
}

export interface PurgeResult {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly purgedConversations: number;
  readonly purgedMessages: number;
}
