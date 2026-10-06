import type { Conversation, ListConversationsQuery } from '../../domain/index.js';
import { InvalidRequestError } from '../../domain/index.js';
import type { ConversationRepositoryPort } from '../ports/conversation-repository.port.js';

export interface ListConversationsContext {
  readonly tenantId: string;
  readonly userId?: string | undefined;
  readonly callerServiceName?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class ListConversationsUseCase {
  constructor(private readonly repository: ConversationRepositoryPort) {}

  public async execute(
    query: ListConversationsQuery,
    context: ListConversationsContext,
  ): Promise<{
    readonly conversations: readonly Conversation[];
    readonly total: number;
    readonly hasMore: boolean;
  }> {
    if (!context.tenantId || context.tenantId.trim().length === 0) {
      throw new InvalidRequestError('Tenant ID is required');
    }

    // If caller is an end-user service (billy-api), enforce user filter
    let effectiveUserId = query.userId;
    if (context.callerServiceName === 'billy-api' && context.userId) {
      effectiveUserId = context.userId;
    }

    const effectiveQuery: ListConversationsQuery = {
      ...query,
      userId: effectiveUserId,
      limit: Math.min(100, Math.max(1, query.limit ?? 20)),
    };

    return this.repository.listConversations(context.tenantId, effectiveQuery, context.signal);
  }
}
