import type { Conversation } from '../../domain/index.js';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
  UserMismatchError,
} from '../../domain/index.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface GetConversationContext {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly callerServiceName?: string | undefined;
  readonly allowDeleted?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class GetConversationUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    conversationId: string,
    context: GetConversationContext,
  ): Promise<Conversation> {
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

    if (conversation.status === 'deleted' && !context.allowDeleted) {
      throw new ConversationDeletedError(conversationId);
    }

    // End-user caller ownership check (e.g. from billy-api)
    if (
      context.callerServiceName === 'billy-api' &&
      context.userId &&
      conversation.userId !== context.userId
    ) {
      throw new UserMismatchError(
        `User '${context.userId}' does not own conversation '${conversationId}'`,
      );
    }

    return conversation;
  }
}
