import type { MessageRole } from '@oicunt-ai/ai-types';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  estimateContentTokens,
  InvalidRequestError,
  UserMismatchError,
} from '../../domain/index.js';
import type { AppendMessagesRequestDto, AppendMessagesResponseDto } from '../dtos/message.dto.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface AppendMessagesContext {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly callerServiceName?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

const VALID_ROLES = new Set<MessageRole>(['system', 'user', 'assistant', 'tool']);

export class AppendMessagesUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    conversationId: string,
    dto: AppendMessagesRequestDto,
    context: AppendMessagesContext,
  ): Promise<AppendMessagesResponseDto> {
    if (!context.tenantId || context.tenantId.trim().length === 0) {
      throw new InvalidRequestError('Tenant ID is required');
    }
    if (!conversationId || conversationId.trim().length === 0) {
      throw new InvalidRequestError('Conversation ID is required');
    }
    if (!dto.turnId || dto.turnId.trim().length === 0) {
      throw new InvalidRequestError('turnId is required');
    }
    if (!dto.messages || !Array.isArray(dto.messages) || dto.messages.length === 0) {
      throw new InvalidRequestError('messages array cannot be empty');
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

    if (context.userId && conversation.userId !== context.userId) {
      throw new UserMismatchError(
        `User '${context.userId}' does not own conversation '${conversationId}'`,
      );
    }

    // Validate and enrich messages
    const preparedMessages = dto.messages.map((item, index) => {
      if (!item.role || !VALID_ROLES.has(item.role)) {
        throw new InvalidRequestError(`Invalid role '${item.role}' at message index ${index}`);
      }
      if (item.content === undefined || item.content === null) {
        throw new InvalidRequestError(`Content is required at message index ${index}`);
      }

      const calculatedEstimate =
        typeof item.tokenEstimate === 'number' && item.tokenEstimate > 0
          ? item.tokenEstimate
          : estimateContentTokens(item.content);

      return {
        ...item,
        tokenEstimate: calculatedEstimate,
      };
    });

    const result = await this.repository.appendMessages(
      context.tenantId,
      conversationId,
      dto.turnId,
      preparedMessages,
      context.signal,
    );

    return {
      conversationId,
      turnId: dto.turnId,
      appendedCount: result.appendedMessages.length,
      totalConversationMessages: result.conversation.messageCount,
      totalConversationTokens: result.conversation.totalTokensEstimate,
      messages: result.appendedMessages.map((msg) => ({
        id: msg.id,
        turnId: msg.turnId,
        sequenceNumber: msg.sequenceNumber,
        role: msg.role,
        tokenEstimate: msg.tokenEstimate,
        createdAt: msg.createdAt,
      })),
    };
  }
}
