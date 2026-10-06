import type { Conversation, ConversationStatus } from '../../domain/index.js';

export interface CreateConversationRequestDto {
  readonly title?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly retentionExpiresAt?: string | null | undefined;
}

export interface UpdateConversationRequestDto {
  readonly title?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly status?: ConversationStatus | undefined;
  readonly retentionExpiresAt?: string | null | undefined;
}

export interface ConversationResponseDto {
  readonly conversation: Conversation;
}

export interface ListConversationsResponseDto {
  readonly conversations: readonly Conversation[];
  readonly total: number;
  readonly hasMore: boolean;
}
