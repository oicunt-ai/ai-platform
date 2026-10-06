import type { ChatMessage } from '@oicunt-ai/ai-types';
import type {
  CheckpointTurnRequest,
  ContextRetrievalOptions,
  HydratedConversationContext,
  MemoryCallContext,
  MemoryPort,
} from '../../src/application/ports/memory.port.js';

export class FakeMemory implements MemoryPort {
  public isHealthy = true;
  public recordedContextCalls: Array<{
    conversationId: string;
    options: ContextRetrievalOptions;
    context: MemoryCallContext;
  }> = [];
  public recordedCheckpoints: Array<{
    request: CheckpointTurnRequest;
    context: MemoryCallContext;
  }> = [];
  public shouldFailGetContextWith: Error | null = null;
  public shouldFailCheckpointWith: Error | null = null;

  public conversations = new Map<string, ChatMessage[]>();

  public setConversationMessages(conversationId: string, messages: readonly ChatMessage[]): void {
    this.conversations.set(conversationId, [...messages]);
  }

  public async getContext(
    conversationId: string,
    options: ContextRetrievalOptions,
    context: MemoryCallContext,
    _signal?: AbortSignal,
  ): Promise<HydratedConversationContext> {
    this.recordedContextCalls.push({ conversationId, options, context });

    if (this.shouldFailGetContextWith) {
      throw this.shouldFailGetContextWith;
    }

    const messages = this.conversations.get(conversationId) ?? [];
    return {
      conversationId,
      messages,
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
    context: MemoryCallContext,
    _signal?: AbortSignal,
  ): Promise<void> {
    this.recordedCheckpoints.push({ request, context });

    if (this.shouldFailCheckpointWith) {
      throw this.shouldFailCheckpointWith;
    }

    const existing = this.conversations.get(request.conversationId) ?? [];
    const newMessages: ChatMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
      ...(m.metadata ? { metadata: m.metadata } : {}),
    }));
    this.conversations.set(request.conversationId, [...existing, ...newMessages]);
  }

  public async checkHealth(_signal?: AbortSignal): Promise<boolean> {
    return this.isHealthy;
  }
}
