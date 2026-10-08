import type { ChatMessage } from '@oicunt-ai/ai-types';
import type {
  CheckpointTurnRequest,
  ContextRetrievalOptions,
  HydratedConversationContext,
  MemoryCallContext,
  MemoryPort,
} from '../../application/ports/memory.port.js';

/**
 * Lightweight, in-memory implementation of MemoryPort used for test environments
 * and isolated service execution without requiring an external PostgreSQL database.
 */
export class InMemoryMemoryClient implements MemoryPort {
  private readonly conversations = new Map<string, ChatMessage[]>();

  public async getContext(
    conversationId: string,
    _options: ContextRetrievalOptions = {},
    _context: MemoryCallContext = { correlationId: '', requestId: '' },
    _signal?: AbortSignal,
  ): Promise<HydratedConversationContext> {
    const messages = this.conversations.get(conversationId) ?? [];
    return {
      conversationId,
      messages: [...messages],
      summary: null,
      estimatedTokens: messages.length * 10,
      hasMore: false,
      totalStoredMessages: messages.length,
      returnedMessages: messages.length,
      earliestSequenceNumber: messages.length > 0 ? 1 : null,
      latestSequenceNumber: messages.length > 0 ? messages.length : null,
    };
  }

  public async checkpointTurn(
    request: CheckpointTurnRequest,
    _context: MemoryCallContext = { correlationId: '', requestId: '' },
    _signal?: AbortSignal,
  ): Promise<void> {
    const existing = this.conversations.get(request.conversationId) ?? [];
    for (const msg of request.messages) {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const chatMsg: ChatMessage =
        msg.name !== undefined
          ? { role: msg.role, content, name: msg.name }
          : { role: msg.role, content };
      existing.push(chatMsg);
    }
    this.conversations.set(request.conversationId, existing);
  }

  public async checkHealth(_signal?: AbortSignal): Promise<boolean> {
    return true;
  }

  public clear(): void {
    this.conversations.clear();
  }
}
