import type { ChatMessage } from '@oicunt-ai/ai-types';

/**
 * Future extension port for working memory and durable conversation history (services/memory).
 */
export interface ConversationMemoryPort {
  /**
   * Retrieves previous conversational context turns for a conversation thread.
   */
  getHistory(conversationId: string, limit?: number): Promise<readonly ChatMessage[]>;

  /**
   * Appends newly completed turns to the durable conversation memory store.
   */
  appendTurn(
    conversationId: string,
    userMessage: ChatMessage,
    assistantMessage: ChatMessage,
  ): Promise<void>;
}
