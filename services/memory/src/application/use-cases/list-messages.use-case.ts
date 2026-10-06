import type { ConversationMessage, ListMessagesQuery } from '../../domain/index.js';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
  UserMismatchError,
} from '../../domain/index.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface ListMessagesContext {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly callerServiceName?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class ListMessagesUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    conversationId: string,
    query: ListMessagesQuery,
    context: ListMessagesContext,
  ): Promise<{
    readonly messages: readonly ConversationMessage[];
    readonly hasMore: boolean;
  }> {
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

    const effectiveQuery: ListMessagesQuery = {
      ...query,
      limit: Math.min(100, Math.max(1, query.limit ?? 50)),
    };

    return this.repository.listMessages(
      context.tenantId,
      conversationId,
      effectiveQuery,
      context.signal,
    );
  }
}
