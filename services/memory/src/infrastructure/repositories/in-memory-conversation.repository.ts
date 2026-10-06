import { randomUUID } from 'node:crypto';
import type {
  Conversation,
  ConversationMessage,
  ConversationStatus,
  ListConversationsQuery,
  ListMessagesQuery,
  MemorySummary,
  PurgeResult,
} from '../../domain/index.js';
import { ConversationDeletedError, ConversationNotFoundError } from '../../domain/index.js';
import type { AppendMessageItem } from '../../application/dtos/message.dto.js';
import type { ConversationRepositoryPort } from '../../application/ports/conversation-repository.port.js';

export class InMemoryConversationRepository implements ConversationRepositoryPort {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, ConversationMessage>();
  private readonly summaries = new Map<string, MemorySummary>();

  public async createConversation(
    conversation: Conversation,
    _signal?: AbortSignal,
  ): Promise<Conversation> {
    this.conversations.set(conversation.id, { ...conversation });
    return { ...conversation };
  }

  public async getConversationById(
    tenantId: string,
    conversationId: string,
    _signal?: AbortSignal,
  ): Promise<Conversation | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.tenantId !== tenantId) {
      return null;
    }
    return { ...conv };
  }

  public async listConversations(
    tenantId: string,
    options?: ListConversationsQuery,
    _signal?: AbortSignal,
  ): Promise<{
    readonly conversations: readonly Conversation[];
    readonly total: number;
    readonly hasMore: boolean;
  }> {
    const limit = options?.limit ?? 20;
    const all = Array.from(this.conversations.values()).filter((c) => {
      if (c.tenantId !== tenantId) {
        return false;
      }
      if (options?.userId && c.userId !== options.userId) {
        return false;
      }
      if (options?.status && options.status !== 'all') {
        return c.status === options.status;
      }
      if (!options?.status) {
        return c.status !== 'deleted';
      }
      return true;
    });

    const order = options?.order ?? 'desc';
    all.sort((a, b) => {
      const cmp = a.updatedAt.localeCompare(b.updatedAt);
      return order === 'asc' ? cmp : -cmp;
    });

    const total = all.length;
    const hasMore = total > limit;
    const slice = all.slice(0, limit);

    return {
      conversations: slice.map((c) => ({ ...c })),
      total,
      hasMore,
    };
  }

  public async updateConversation(
    tenantId: string,
    conversationId: string,
    patch: {
      readonly title?: string | null | undefined;
      readonly metadata?: Record<string, unknown> | undefined;
      readonly status?: ConversationStatus | undefined;
      readonly retentionExpiresAt?: string | null | undefined;
    },
    _signal?: AbortSignal,
  ): Promise<Conversation> {
    const existing = this.conversations.get(conversationId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new ConversationNotFoundError(conversationId);
    }

    const updated: Conversation = {
      ...existing,
      title: patch.title !== undefined ? patch.title : existing.title,
      metadata:
        patch.metadata !== undefined
          ? { ...existing.metadata, ...patch.metadata }
          : existing.metadata,
      status: patch.status !== undefined ? patch.status : existing.status,
      retentionExpiresAt:
        patch.retentionExpiresAt !== undefined
          ? patch.retentionExpiresAt
          : existing.retentionExpiresAt,
      updatedAt: new Date().toISOString(),
    };

    this.conversations.set(conversationId, updated);
    return { ...updated };
  }

  public async softDeleteConversation(
    tenantId: string,
    conversationId: string,
    _signal?: AbortSignal,
  ): Promise<void> {
    const existing = this.conversations.get(conversationId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new ConversationNotFoundError(conversationId);
    }

    const now = new Date().toISOString();
    const updated: Conversation = {
      ...existing,
      status: 'deleted',
      deletedAt: now,
      updatedAt: now,
    };

    this.conversations.set(conversationId, updated);
  }

  public async hardPurgeConversation(
    tenantId: string,
    conversationId: string,
    _signal?: AbortSignal,
  ): Promise<void> {
    const existing = this.conversations.get(conversationId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new ConversationNotFoundError(conversationId);
    }

    this.conversations.delete(conversationId);

    // Cascading delete messages
    for (const [id, msg] of this.messages.entries()) {
      if (msg.conversationId === conversationId && msg.tenantId === tenantId) {
        this.messages.delete(id);
      }
    }

    // Cascading delete summaries
    for (const [id, sum] of this.summaries.entries()) {
      if (sum.conversationId === conversationId && sum.tenantId === tenantId) {
        this.summaries.delete(id);
      }
    }
  }

  public async appendMessages(
    tenantId: string,
    conversationId: string,
    turnId: string,
    messages: readonly AppendMessageItem[],
    _signal?: AbortSignal,
  ): Promise<{
    readonly conversation: Conversation;
    readonly appendedMessages: readonly ConversationMessage[];
  }> {
    const existing = this.conversations.get(conversationId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (existing.status === 'deleted') {
      throw new ConversationDeletedError(conversationId);
    }

    // Calculate current max sequence
    let currentMaxSeq = 0;
    for (const msg of this.messages.values()) {
      if (msg.conversationId === conversationId && msg.tenantId === tenantId) {
        if (msg.sequenceNumber > currentMaxSeq) {
          currentMaxSeq = msg.sequenceNumber;
        }
      }
    }

    const appendedMessages: ConversationMessage[] = [];
    let addedTokens = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < messages.length; i++) {
      const item = messages[i]!;
      const seq = currentMaxSeq + i + 1;
      const msgId = `msg_${randomUUID().replace(/-/g, '')}`;
      const tokenEst = item.tokenEstimate ?? 0;
      addedTokens += tokenEst;

      const newMsg: ConversationMessage = {
        id: msgId,
        conversationId,
        tenantId,
        turnId,
        sequenceNumber: seq,
        role: item.role,
        content: item.content,
        name: item.name ?? null,
        tokenEstimate: tokenEst,
        metadata: item.metadata ?? {},
        createdAt: now,
      };

      this.messages.set(msgId, newMsg);
      appendedMessages.push(newMsg);
    }

    const updatedConv: Conversation = {
      ...existing,
      messageCount: existing.messageCount + messages.length,
      totalTokensEstimate: existing.totalTokensEstimate + addedTokens,
      lastMessageAt: now,
      updatedAt: now,
    };

    this.conversations.set(conversationId, updatedConv);

    return {
      conversation: { ...updatedConv },
      appendedMessages: Object.freeze(appendedMessages),
    };
  }

  public async listMessages(
    tenantId: string,
    conversationId: string,
    query?: ListMessagesQuery,
    _signal?: AbortSignal,
  ): Promise<{
    readonly messages: readonly ConversationMessage[];
    readonly hasMore: boolean;
  }> {
    const limit = query?.limit ?? 50;
    const order = query?.order ?? 'asc';

    const msgs = Array.from(this.messages.values()).filter((m) => {
      if (m.conversationId !== conversationId || m.tenantId !== tenantId) {
        return false;
      }
      if (typeof query?.afterSequence === 'number' && m.sequenceNumber <= query.afterSequence) {
        return false;
      }
      if (typeof query?.beforeSequence === 'number' && m.sequenceNumber >= query.beforeSequence) {
        return false;
      }
      return true;
    });

    msgs.sort((a, b) => {
      return order === 'asc'
        ? a.sequenceNumber - b.sequenceNumber
        : b.sequenceNumber - a.sequenceNumber;
    });

    const hasMore = msgs.length > limit;
    const slice = msgs.slice(0, limit);

    return {
      messages: slice.map((m) => ({ ...m })),
      hasMore,
    };
  }

  public async getContextMessages(
    tenantId: string,
    conversationId: string,
    maxTokens: number,
    maxMessages: number,
    beforeSequenceNumber?: number,
    afterSequenceNumber?: number,
    _signal?: AbortSignal,
  ): Promise<{
    readonly messages: readonly ConversationMessage[];
    readonly totalStoredMessages: number;
    readonly hasMore: boolean;
  }> {
    const allForConv = Array.from(this.messages.values()).filter(
      (m) => m.conversationId === conversationId && m.tenantId === tenantId,
    );
    const totalStoredMessages = allForConv.length;

    // Filter candidates by sequence bounds
    const candidates = allForConv.filter((m) => {
      if (typeof beforeSequenceNumber === 'number' && m.sequenceNumber >= beforeSequenceNumber) {
        return false;
      }
      if (typeof afterSequenceNumber === 'number' && m.sequenceNumber <= afterSequenceNumber) {
        return false;
      }
      return true;
    });

    // Sort descending for reverse accumulation
    candidates.sort((a, b) => b.sequenceNumber - a.sequenceNumber);

    const accumulated: ConversationMessage[] = [];
    let cumulativeTokens = 0;
    let hasMore = false;

    for (const msg of candidates) {
      if (accumulated.length >= maxMessages || cumulativeTokens + msg.tokenEstimate > maxTokens) {
        hasMore = true;
        break;
      }
      accumulated.push(msg);
      cumulativeTokens += msg.tokenEstimate;
    }

    // Chronological inversion
    accumulated.reverse();

    return {
      messages: Object.freeze(accumulated.map((m) => ({ ...m }))),
      totalStoredMessages,
      hasMore,
    };
  }

  public async getLatestSummary(
    tenantId: string,
    conversationId: string,
    beforeSequenceNumber?: number,
    _signal?: AbortSignal,
  ): Promise<MemorySummary | null> {
    const sums = Array.from(this.summaries.values()).filter((s) => {
      if (s.conversationId !== conversationId || s.tenantId !== tenantId) {
        return false;
      }
      if (typeof beforeSequenceNumber === 'number' && s.sequenceEnd >= beforeSequenceNumber) {
        return false;
      }
      return true;
    });

    if (sums.length === 0) {
      return null;
    }

    sums.sort((a, b) => b.sequenceEnd - a.sequenceEnd);
    return { ...sums[0]! };
  }

  public async saveSummary(summary: MemorySummary, _signal?: AbortSignal): Promise<MemorySummary> {
    this.summaries.set(summary.id, { ...summary });
    return { ...summary };
  }

  public async purgeTenantOrUserData(
    tenantId: string,
    userId?: string,
    _signal?: AbortSignal,
  ): Promise<PurgeResult> {
    let purgedConversations = 0;
    let purgedMessages = 0;

    const targetConvIds = new Set<string>();

    for (const [id, conv] of this.conversations.entries()) {
      if (conv.tenantId === tenantId) {
        if (!userId || conv.userId === userId) {
          targetConvIds.add(id);
          this.conversations.delete(id);
          purgedConversations++;
        }
      }
    }

    for (const [id, msg] of this.messages.entries()) {
      if (msg.tenantId === tenantId) {
        if (targetConvIds.has(msg.conversationId)) {
          this.messages.delete(id);
          purgedMessages++;
        }
      }
    }

    for (const [id, sum] of this.summaries.entries()) {
      if (sum.tenantId === tenantId) {
        if (targetConvIds.has(sum.conversationId)) {
          this.summaries.delete(id);
        }
      }
    }

    return {
      tenantId,
      userId: userId ?? null,
      purgedConversations,
      purgedMessages,
    };
  }

  public clear(): void {
    this.conversations.clear();
    this.messages.clear();
    this.summaries.clear();
  }
}
