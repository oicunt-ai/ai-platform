import { randomUUID } from 'node:crypto';
import type { Conversation, ConversationStatus } from '../../domain/index.js';
import { InvalidRequestError } from '../../domain/index.js';
import type { CreateConversationRequestDto } from '../dtos/conversation.dto.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface CreateConversationContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly signal?: AbortSignal | undefined;
}

export class CreateConversationUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    dto: CreateConversationRequestDto,
    context: CreateConversationContext,
  ): Promise<Conversation> {
    if (!context.tenantId || context.tenantId.trim().length === 0) {
      throw new InvalidRequestError('Tenant ID is required to create a conversation');
    }
    if (!context.userId || context.userId.trim().length === 0) {
      throw new InvalidRequestError('User ID is required to create a conversation');
    }

    const now = new Date().toISOString();
    const id = `conv_${randomUUID().replace(/-/g, '')}`;

    const conversation: Conversation = {
      id,
      tenantId: context.tenantId,
      userId: context.userId,
      title: dto.title?.trim() || null,
      status: 'active' as ConversationStatus,
      metadata: dto.metadata ?? {},
      messageCount: 0,
      totalTokensEstimate: 0,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
      retentionExpiresAt: dto.retentionExpiresAt ?? null,
      deletedAt: null,
    };

    return this.repository.createConversation(conversation, context.signal);
  }
}
