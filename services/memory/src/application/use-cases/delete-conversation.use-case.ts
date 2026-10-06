import {
  ConversationNotFoundError,
  InvalidRequestError,
  UserMismatchError,
} from '../../domain/index.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface DeleteConversationContext {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly callerServiceName?: string | undefined;
  readonly hard?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class DeleteConversationUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    conversationId: string,
    context: DeleteConversationContext,
  ): Promise<{ readonly conversationId: string; readonly hard: boolean }> {
    if (!context.tenantId || context.tenantId.trim().length === 0) {
      throw new InvalidRequestError('Tenant ID is required');
    }
    if (!conversationId || conversationId.trim().length === 0) {
      throw new InvalidRequestError('Conversation ID is required');
    }

    const existing = await this.repository.getConversationById(
      context.tenantId,
      conversationId,
      context.signal,
    );

    if (!existing) {
      throw new ConversationNotFoundError(conversationId);
    }

    if (
      context.callerServiceName === 'billy-api' &&
      context.userId &&
      existing.userId !== context.userId
    ) {
      throw new UserMismatchError(
        `User '${context.userId}' does not own conversation '${conversationId}'`,
      );
    }

    const isHard = context.hard === true;
    if (isHard) {
      await this.repository.hardPurgeConversation(context.tenantId, conversationId, context.signal);
    } else {
      await this.repository.softDeleteConversation(
        context.tenantId,
        conversationId,
        context.signal,
      );
    }

    return {
      conversationId,
      hard: isHard,
    };
  }
}
