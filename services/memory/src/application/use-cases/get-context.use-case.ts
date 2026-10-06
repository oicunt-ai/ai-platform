import type { ChatMessage } from '@oicunt-ai/ai-types';
import type { MemorySummary } from '../../domain/index.js';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
  UserMismatchError,
} from '../../domain/index.js';
import type { ContextRetrievalDataDto, ContextRetrievalRequestDto } from '../dtos/context.dto.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface GetContextRetrievalContext {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly callerServiceName?: string | undefined;
  readonly defaultMaxTokens?: number | undefined;
  readonly defaultMaxMessages?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class GetContextUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    conversationId: string,
    dto: ContextRetrievalRequestDto,
    context: GetContextRetrievalContext,
  ): Promise<ContextRetrievalDataDto> {
    if (!context.tenantId || context.tenantId.trim().length === 0) {
      throw new InvalidRequestError('Tenant ID is required');
    }
    if (!conversationId || conversationId.trim().length === 0) {
      throw new InvalidRequestError('Conversation ID is required');
    }

    const conversation = await this.repository.getConversationById(
      context.tenantId,
      conversationId,
      context.signal,
    );

    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    if (conversation.status === 'deleted') {
      throw new ConversationDeletedError(conversationId);
    }

    if (
      context.callerServiceName === 'billy-api' &&
      context.userId &&
      conversation.userId !== context.userId
    ) {
      throw new UserMismatchError(
        `User '${context.userId}' does not own conversation '${conversationId}'`,
      );
    }

    const maxTokens = Math.max(1, dto.maxTokens ?? context.defaultMaxTokens ?? 8192);
    const maxMessages = Math.max(1, dto.maxMessages ?? context.defaultMaxMessages ?? 50);
    const includeSummary = dto.includeSummary ?? true;
    const beforeSequence = dto.beforeSequenceNumber;

    // 1. Active Summary Lookup (if enabled)
    let summary: MemorySummary | null = null;
    let afterSequence: number | undefined;

    if (includeSummary) {
      summary = await this.repository.getLatestSummary(
        context.tenantId,
        conversationId,
        beforeSequence,
        context.signal,
      );
      if (summary) {
        afterSequence = summary.sequenceEnd;
      }
    }

    // 2. Fetch messages within sequence bounds
    const messagesResult = await this.repository.getContextMessages(
      context.tenantId,
      conversationId,
      maxTokens,
      maxMessages,
      beforeSequence,
      afterSequence,
      context.signal,
    );

    // 3. Sliding window reverse accumulation and chronological ordering
    // (getContextMessages returns chronological sequenceNumber ASC already bounded)
    const rawMessages = messagesResult.messages;

    let attachedSummaryText: string | null = null;
    let totalEstimatedTokens = 0;

    for (const msg of rawMessages) {
      totalEstimatedTokens += msg.tokenEstimate;
    }

    // Determine hasMore: if older messages were excluded by sliding window or summary
    let hasMore = messagesResult.hasMore;

    if (summary && summary.summaryText) {
      // Check if summary represents messages before the earliest retrieved message
      const earliestSeq = rawMessages[0]?.sequenceNumber;
      if (earliestSeq === undefined || summary.sequenceEnd < earliestSeq) {
        attachedSummaryText = summary.summaryText;
        totalEstimatedTokens += summary.tokenEstimate;
        hasMore = true;
      }
    }

    // Map to canonical ChatMessage[] instances conformant to @oicunt-ai/ai-types
    const chatMessages: ChatMessage[] = rawMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      ...(msg.name ? { name: msg.name } : {}),
      metadata: {
        messageId: msg.id,
        turnId: msg.turnId,
        sequenceNumber: msg.sequenceNumber,
        tokenEstimate: msg.tokenEstimate,
        createdAt: msg.createdAt,
        ...msg.metadata,
      },
    }));

    const earliestSequenceNumber =
      rawMessages.length > 0 ? (rawMessages[0]?.sequenceNumber ?? null) : null;
    const latestSequenceNumber =
      rawMessages.length > 0 ? (rawMessages[rawMessages.length - 1]?.sequenceNumber ?? null) : null;

    return {
      conversationId,
      messages: chatMessages,
      summary: attachedSummaryText,
      estimatedTokens: totalEstimatedTokens,
      hasMore,
      totalStoredMessages: messagesResult.totalStoredMessages,
      returnedMessages: chatMessages.length,
      earliestSequenceNumber,
      latestSequenceNumber,
    };
  }
}
