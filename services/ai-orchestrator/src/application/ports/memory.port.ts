import type { ChatMessage, MessageContentPart, MessageRole } from '@oicunt-ai/ai-types';

export interface ContextRetrievalOptions {
  readonly maxTokens?: number | undefined;
  readonly maxMessages?: number | undefined;
  readonly includeSummary?: boolean | undefined;
  readonly beforeSequenceNumber?: number | undefined;
}

export interface HydratedConversationContext {
  readonly conversationId: string;
  readonly messages: readonly ChatMessage[];
  readonly summary: string | null;
  readonly estimatedTokens: number;
  readonly hasMore: boolean;
  readonly totalStoredMessages: number;
  readonly returnedMessages: number;
  readonly earliestSequenceNumber: number | null;
  readonly latestSequenceNumber: number | null;
}

export interface CheckpointMessageItem {
  readonly role: MessageRole;
  readonly content: string | readonly MessageContentPart[];
  readonly name?: string | undefined;
  readonly tokenEstimate?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface CheckpointTurnRequest {
  readonly conversationId: string;
  readonly turnId: string;
  readonly messages: readonly CheckpointMessageItem[];
}

export interface MemoryCallContext {
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly correlationId: string;
  readonly requestId: string;
  readonly turnId?: string | undefined;
  readonly deadlineMs?: number | undefined;
}

/**
 * Outbound port for interacting with the Memory Service (Conversation Memory Store).
 */
export interface MemoryPort {
  createConversation?(
    body: unknown,
    context: MemoryCallContext,
    signal?: AbortSignal | undefined,
  ): Promise<unknown>;

  listConversations?(
    context: MemoryCallContext,
    signal?: AbortSignal | undefined,
  ): Promise<unknown>;

  listMessages?(
    conversationId: string,
    context: MemoryCallContext,
    signal?: AbortSignal | undefined,
  ): Promise<unknown>;
  /**
   * Hydrates bounded conversation context history from the Memory Service.
   */
  getContext(
    conversationId: string,
    options: ContextRetrievalOptions,
    context: MemoryCallContext,
    signal?: AbortSignal | undefined,
  ): Promise<HydratedConversationContext>;

  /**
   * Checkpoints a completed turn (user messages + assistant response) to the Memory Service.
   */
  checkpointTurn(
    request: CheckpointTurnRequest,
    context: MemoryCallContext,
    signal?: AbortSignal | undefined,
  ): Promise<void>;

  /**
   * Probes health and reachability of the Memory Service.
   */
  checkHealth(signal?: AbortSignal | undefined): Promise<boolean>;
}
