import type { MessageContentPart, MessageRole } from '@oicunt-ai/ai-types';
import type { ConversationMessage } from '../../domain/index.js';

export interface AppendMessageItem {
  readonly role: MessageRole;
  readonly content: string | readonly MessageContentPart[];
  readonly name?: string | undefined;
  readonly tokenEstimate?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface AppendMessagesRequestDto {
  readonly turnId: string;
  readonly messages: readonly AppendMessageItem[];
}

export interface AppendedMessageResult {
  readonly id: string;
  readonly turnId: string;
  readonly sequenceNumber: number;
  readonly role: MessageRole;
  readonly tokenEstimate: number;
  readonly createdAt: string;
}

export interface AppendMessagesResponseDto {
  readonly conversationId: string;
  readonly turnId: string;
  readonly appendedCount: number;
  readonly totalConversationMessages: number;
  readonly totalConversationTokens: number;
  readonly messages: readonly AppendedMessageResult[];
}

export interface ListMessagesResponseDto {
  readonly messages: readonly ConversationMessage[];
  readonly hasMore: boolean;
}
