import type {
  Conversation,
  ConversationMessage,
  ConversationStatus,
  ListConversationsQuery,
  ListMessagesQuery,
  MemorySummary,
  PurgeResult,
} from '../../domain/index.js';
import type { AppendMessageItem } from '../dtos/message.dto.js';

export interface ConversationRepositoryPort {
  createConversation(conversation: Conversation, signal?: AbortSignal): Promise<Conversation>;

  getConversationById(
    tenantId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<Conversation | null>;

  listConversations(
    tenantId: string,
    options?: ListConversationsQuery,
    signal?: AbortSignal,
  ): Promise<{
    readonly conversations: readonly Conversation[];
    readonly total: number;
    readonly hasMore: boolean;
  }>;

  updateConversation(
    tenantId: string,
    conversationId: string,
    patch: {
      readonly title?: string | null | undefined;
      readonly metadata?: Record<string, unknown> | undefined;
      readonly status?: ConversationStatus | undefined;
      readonly retentionExpiresAt?: string | null | undefined;
    },
    signal?: AbortSignal,
  ): Promise<Conversation>;

  softDeleteConversation(
    tenantId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<void>;

  hardPurgeConversation(
    tenantId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<void>;

  appendMessages(
    tenantId: string,
    conversationId: string,
    turnId: string,
    messages: readonly AppendMessageItem[],
    signal?: AbortSignal,
  ): Promise<{
    readonly conversation: Conversation;
    readonly appendedMessages: readonly ConversationMessage[];
  }>;

  listMessages(
    tenantId: string,
    conversationId: string,
    query?: ListMessagesQuery,
    signal?: AbortSignal,
  ): Promise<{
    readonly messages: readonly ConversationMessage[];
    readonly hasMore: boolean;
  }>;

  getContextMessages(
    tenantId: string,
    conversationId: string,
    maxTokens: number,
    maxMessages: number,
    beforeSequenceNumber?: number,
    afterSequenceNumber?: number,
    signal?: AbortSignal,
  ): Promise<{
    readonly messages: readonly ConversationMessage[];
    readonly totalStoredMessages: number;
    readonly hasMore: boolean;
  }>;

  getLatestSummary(
    tenantId: string,
    conversationId: string,
    beforeSequenceNumber?: number,
    signal?: AbortSignal,
  ): Promise<MemorySummary | null>;

  saveSummary?(summary: MemorySummary, signal?: AbortSignal): Promise<MemorySummary>;

  purgeTenantOrUserData(
    tenantId: string,
    userId?: string,
    signal?: AbortSignal,
  ): Promise<PurgeResult>;
}
