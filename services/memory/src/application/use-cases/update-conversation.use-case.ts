import type { Conversation, ConversationStatus } from '../../domain/index.js';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
  UserMismatchError,
} from '../../domain/index.js';
import type { UpdateConversationRequestDto } from '../dtos/conversation.dto.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface UpdateConversationContext {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly callerServiceName?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class UpdateConversationUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    conversationId: string,
    dto: UpdateConversationRequestDto,
    context: UpdateConversationContext,
  ): Promise<Conversation> {
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

    if (existing.status === 'deleted') {
      throw new ConversationDeletedError(conversationId);
    }

    if (context.userId && existing.userId !== context.userId) {
      throw new UserMismatchError(
        `User '${context.userId}' does not own conversation '${conversationId}'`,
      );
    }

    if (dto.status && dto.status !== 'active' && dto.status !== 'archived') {
      throw new InvalidRequestError(
        `Invalid status '${dto.status}'. Allowed updates are 'active' or 'archived'.`,
      );
    }

    return this.repository.updateConversation(
      context.tenantId,
      conversationId,
      {
        title: dto.title !== undefined ? dto.title?.trim() || null : undefined,
        metadata: dto.metadata,
        status: dto.status as ConversationStatus | undefined,
        retentionExpiresAt: dto.retentionExpiresAt,
      },
      context.signal,
    );
  }
}
