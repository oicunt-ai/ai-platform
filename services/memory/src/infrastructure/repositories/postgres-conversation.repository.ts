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
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
} from '../../domain/index.js';
import type { AppendMessageItem } from '../../application/dtos/message.dto.js';
import type { ConversationRepositoryPort } from '../../application/ports/conversation-repository.port.js';
import type { DatabasePool } from '../database/connection.js';

interface ConversationRow {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string | null;
  status: string;
  metadata: Record<string, unknown>;
  message_count: number;
  total_tokens_estimate: number;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
  retention_expires_at: Date | null;
  deleted_at: Date | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  tenant_id: string;
  turn_id: string;
  turn_ordinal: number;
  sequence_number: number;
  role: string;
  content: unknown;
  name: string | null;
  token_estimate: number;
  metadata: Record<string, unknown>;
  created_at: Date;
}

interface SummaryRow {
  id: string;
  conversation_id: string;
  tenant_id: string;
  sequence_start: number;
  sequence_end: number;
  summary_text: string;
  token_estimate: number;
  metadata: Record<string, unknown>;
  created_at: Date;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    title: row.title,
    status: row.status as ConversationStatus,
    metadata: row.metadata ?? {},
    messageCount: Number(row.message_count),
    totalTokensEstimate: Number(row.total_tokens_estimate),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : null,
    retentionExpiresAt: row.retention_expires_at ? row.retention_expires_at.toISOString() : null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    turnId: row.turn_id,
    turnOrdinal: Number(row.turn_ordinal),
    sequenceNumber: Number(row.sequence_number),
    role: row.role as ConversationMessage['role'],
    content: (typeof row.content === 'string'
      ? row.content
      : row.content) as ConversationMessage['content'],
    name: row.name,
    tokenEstimate: Number(row.token_estimate),
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

function mapSummary(row: SummaryRow): MemorySummary {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    sequenceStart: Number(row.sequence_start),
    sequenceEnd: Number(row.sequence_end),
    summaryText: row.summary_text,
    tokenEstimate: Number(row.token_estimate),
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresConversationRepository implements ConversationRepositoryPort {
  constructor(private readonly db: DatabasePool) {}

  public async createConversation(
    conversation: Conversation,
    signal?: AbortSignal,
  ): Promise<Conversation> {
    const sql = `
      INSERT INTO oicunt_memory.conversations (
        id, tenant_id, user_id, title, status, metadata,
        message_count, total_tokens_estimate, created_at, updated_at,
        last_message_at, retention_expires_at, deleted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *;
    `;
    const params = [
      conversation.id,
      conversation.tenantId,
      conversation.userId,
      conversation.title,
      conversation.status,
      JSON.stringify(conversation.metadata),
      conversation.messageCount,
      conversation.totalTokensEstimate,
      conversation.createdAt,
      conversation.updatedAt,
      conversation.lastMessageAt,
      conversation.retentionExpiresAt,
      conversation.deletedAt,
    ];

    const result = await this.db.query<ConversationRow>(sql, params, { signal });
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert conversation');
    }
    return mapConversation(row);
  }

  public async getConversationById(
    tenantId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<Conversation | null> {
    const sql = `
      SELECT * FROM oicunt_memory.conversations
      WHERE id = $1 AND tenant_id = $2;
    `;
    const result = await this.db.query<ConversationRow>(sql, [conversationId, tenantId], {
      signal,
    });
    const row = result.rows[0];
    return row ? mapConversation(row) : null;
  }

  public async listConversations(
    tenantId: string,
    options?: ListConversationsQuery,
    signal?: AbortSignal,
  ): Promise<{
    readonly conversations: readonly Conversation[];
    readonly total: number;
    readonly hasMore: boolean;
  }> {
    const limit = options?.limit ?? 20;
    const conditions = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    let pIndex = 2;

    if (options?.userId) {
      conditions.push(`user_id = $${pIndex++}`);
      params.push(options.userId);
    }

    if (options?.status && options.status !== 'all') {
      conditions.push(`status = $${pIndex++}`);
      params.push(options.status);
    } else if (!options?.status) {
      // Default: exclude soft-deleted conversations
      conditions.push(`status != 'deleted'`);
    }

    const whereClause = conditions.join(' AND ');

    // Total count
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM oicunt_memory.conversations WHERE ${whereClause}`,
      params,
      { signal },
    );
    const total = Number.parseInt(countRes.rows[0]?.count ?? '0', 10);

    const order = options?.order === 'asc' ? 'ASC' : 'DESC';
    const listSql = `
      SELECT * FROM oicunt_memory.conversations
      WHERE ${whereClause}
      ORDER BY updated_at ${order}
      LIMIT $${pIndex};
    `;
    params.push(limit + 1);

    const result = await this.db.query<ConversationRow>(listSql, params, { signal });
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    return {
      conversations: rows.map(mapConversation),
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
    signal?: AbortSignal,
  ): Promise<Conversation> {
    const updates: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [conversationId, tenantId];

    if (patch.title !== undefined) {
      params.push(patch.title);
      updates.push(`title = $${params.length}`);
    }
    if (patch.metadata !== undefined) {
      params.push(JSON.stringify(patch.metadata));
      updates.push(`metadata = $${params.length}`);
    }
    if (patch.status !== undefined) {
      params.push(patch.status);
      updates.push(`status = $${params.length}`);
    }
    if (patch.retentionExpiresAt !== undefined) {
      params.push(patch.retentionExpiresAt);
      updates.push(`retention_expires_at = $${params.length}`);
    }

    const sql = `
      UPDATE oicunt_memory.conversations
      SET ${updates.join(', ')}
      WHERE id = $1 AND tenant_id = $2
      RETURNING *;
    `;

    const result = await this.db.query<ConversationRow>(sql, params, { signal });
    const row = result.rows[0];
    if (!row) {
      throw new ConversationNotFoundError(conversationId);
    }
    return mapConversation(row);
  }

  public async softDeleteConversation(
    tenantId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const sql = `
      UPDATE oicunt_memory.conversations
      SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2;
    `;
    const result = await this.db.query(sql, [conversationId, tenantId], { signal });
    if (result.rowCount === 0) {
      throw new ConversationNotFoundError(conversationId);
    }
  }

  public async hardPurgeConversation(
    tenantId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const sql = `
      DELETE FROM oicunt_memory.conversations
      WHERE id = $1 AND tenant_id = $2;
    `;
    const result = await this.db.query(sql, [conversationId, tenantId], { signal });
    if (result.rowCount === 0) {
      throw new ConversationNotFoundError(conversationId);
    }
  }

  public async appendMessages(
    tenantId: string,
    conversationId: string,
    turnId: string,
    messages: readonly AppendMessageItem[],
    signal?: AbortSignal,
  ): Promise<{
    readonly conversation: Conversation;
    readonly appendedMessages: readonly ConversationMessage[];
  }> {
    return this.db.withTransaction(
      async (client) => {
        // 1. Lock conversation row for update within tenant boundary
        const lockRes = await client.query<ConversationRow>(
          `SELECT * FROM oicunt_memory.conversations WHERE id = $1 AND tenant_id = $2 FOR UPDATE;`,
          [conversationId, tenantId],
        );

        const convRow = lockRes.rows[0];
        if (!convRow) {
          throw new ConversationNotFoundError(conversationId);
        }
        if (convRow.status === 'deleted') {
          throw new ConversationDeletedError(conversationId);
        }

        const existingTurn = await client.query<MessageRow>(
          `SELECT * FROM oicunt_memory.conversation_messages
           WHERE conversation_id = $1 AND tenant_id = $2 AND turn_id = $3
           ORDER BY turn_ordinal ASC;`,
          [conversationId, tenantId, turnId],
        );
        if (existingTurn.rows.length > 0) {
          const matches =
            existingTurn.rows.length === messages.length &&
            existingTurn.rows.every((row, index) => {
              const item = messages[index]!;
              return (
                row.turn_ordinal === index &&
                row.role === item.role &&
                JSON.stringify(row.content) === JSON.stringify(item.content) &&
                row.name === (item.name ?? null)
              );
            });
          if (!matches) {
            throw new InvalidRequestError(
              `Turn '${turnId}' was already checkpointed with different content`,
            );
          }
          return {
            conversation: mapConversation(convRow),
            appendedMessages: existingTurn.rows.map(mapMessage),
          };
        }

        // 2. Fetch current maximum sequence number for this conversation
        const maxSeqRes = await client.query<{ max_seq: string | null }>(
          `SELECT MAX(sequence_number) as max_seq FROM oicunt_memory.conversation_messages WHERE conversation_id = $1 AND tenant_id = $2;`,
          [conversationId, tenantId],
        );
        const currentMaxSeq = maxSeqRes.rows[0]?.max_seq
          ? Number.parseInt(maxSeqRes.rows[0].max_seq, 10)
          : 0;

        const appendedMessages: ConversationMessage[] = [];
        let addedTokens = 0;

        // 3. Insert each message with strictly increasing sequenceNumber
        for (let i = 0; i < messages.length; i++) {
          const item = messages[i]!;
          const seq = currentMaxSeq + i + 1;
          const msgId = `msg_${randomUUID().replace(/-/g, '')}`;
          const tokenEst = item.tokenEstimate ?? 0;
          addedTokens += tokenEst;

          const insertSql = `
          INSERT INTO oicunt_memory.conversation_messages (
            id, conversation_id, tenant_id, turn_id, turn_ordinal, sequence_number,
            role, content, name, token_estimate, metadata, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          RETURNING *;
        `;
          const insertParams = [
            msgId,
            conversationId,
            tenantId,
            turnId,
            i,
            seq,
            item.role,
            typeof item.content === 'string'
              ? JSON.stringify(item.content)
              : JSON.stringify(item.content),
            item.name ?? null,
            tokenEst,
            JSON.stringify(item.metadata ?? {}),
          ];

          const msgRes = await client.query<MessageRow>(insertSql, insertParams);
          const insertedRow = msgRes.rows[0];
          if (insertedRow) {
            appendedMessages.push(mapMessage(insertedRow));
          }
        }

        // 4. Update conversation aggregate counters
        const updateConvSql = `
        UPDATE oicunt_memory.conversations
        SET
          message_count = message_count + $1,
          total_tokens_estimate = total_tokens_estimate + $2,
          last_message_at = NOW(),
          updated_at = NOW()
        WHERE id = $3 AND tenant_id = $4
        RETURNING *;
      `;
        const updateRes = await client.query<ConversationRow>(updateConvSql, [
          messages.length,
          addedTokens,
          conversationId,
          tenantId,
        ]);

        const updatedRow = updateRes.rows[0];
        if (!updatedRow) {
          throw new Error('Failed to update conversation aggregates');
        }

        return {
          conversation: mapConversation(updatedRow),
          appendedMessages: Object.freeze(appendedMessages),
        };
      },
      { signal },
    );
  }

  public async listMessages(
    tenantId: string,
    conversationId: string,
    query?: ListMessagesQuery,
    signal?: AbortSignal,
  ): Promise<{
    readonly messages: readonly ConversationMessage[];
    readonly hasMore: boolean;
  }> {
    const limit = query?.limit ?? 50;
    const order = query?.order === 'desc' ? 'DESC' : 'ASC';

    const conditions = ['conversation_id = $1', 'tenant_id = $2'];
    const params: unknown[] = [conversationId, tenantId];
    let pIndex = 3;

    if (typeof query?.afterSequence === 'number') {
      conditions.push(`sequence_number > $${pIndex++}`);
      params.push(query.afterSequence);
    }
    if (typeof query?.beforeSequence === 'number') {
      conditions.push(`sequence_number < $${pIndex++}`);
      params.push(query.beforeSequence);
    }

    const sql = `
      SELECT * FROM oicunt_memory.conversation_messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY sequence_number ${order}
      LIMIT $${pIndex};
    `;
    params.push(limit + 1);

    const result = await this.db.query<MessageRow>(sql, params, { signal });
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    return {
      messages: rows.map(mapMessage),
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
    signal?: AbortSignal,
  ): Promise<{
    readonly messages: readonly ConversationMessage[];
    readonly totalStoredMessages: number;
    readonly hasMore: boolean;
  }> {
    // 1. Total stored messages for this conversation
    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM oicunt_memory.conversation_messages WHERE conversation_id = $1 AND tenant_id = $2;`,
      [conversationId, tenantId],
      { signal },
    );
    const totalStoredMessages = Number.parseInt(countRes.rows[0]?.count ?? '0', 10);

    // 2. Query messages bounded by sequence constraints ordered sequence_number DESC (reverse accumulation)
    const conditions = ['conversation_id = $1', 'tenant_id = $2'];
    const params: unknown[] = [conversationId, tenantId];

    if (typeof beforeSequenceNumber === 'number') {
      params.push(beforeSequenceNumber);
      conditions.push(`sequence_number < $${params.length}`);
    }
    if (typeof afterSequenceNumber === 'number') {
      params.push(afterSequenceNumber);
      conditions.push(`sequence_number > $${params.length}`);
    }

    const sql = `
      SELECT * FROM oicunt_memory.conversation_messages
      WHERE ${conditions.join(' AND ')}
      ORDER BY sequence_number DESC;
    `;

    const result = await this.db.query<MessageRow>(sql, params, { signal });
    const allCandidates = result.rows.map(mapMessage);

    // 3. Reverse accumulation by token budget and message count
    const accumulated: ConversationMessage[] = [];
    let cumulativeTokens = 0;
    let hasMore = false;

    for (const msg of allCandidates) {
      if (accumulated.length >= maxMessages || cumulativeTokens + msg.tokenEstimate > maxTokens) {
        hasMore = true;
        break;
      }
      accumulated.push(msg);
      cumulativeTokens += msg.tokenEstimate;
    }

    // 4. Chronological Inversion (sequenceNumber ASC)
    accumulated.reverse();

    return {
      messages: Object.freeze(accumulated),
      totalStoredMessages,
      hasMore,
    };
  }

  public async getLatestSummary(
    tenantId: string,
    conversationId: string,
    beforeSequenceNumber?: number,
    signal?: AbortSignal,
  ): Promise<MemorySummary | null> {
    const conditions = ['conversation_id = $1', 'tenant_id = $2'];
    const params: unknown[] = [conversationId, tenantId];

    if (typeof beforeSequenceNumber === 'number') {
      params.push(beforeSequenceNumber);
      conditions.push(`sequence_end < $${params.length}`);
    }

    const sql = `
      SELECT * FROM oicunt_memory.conversation_summaries
      WHERE ${conditions.join(' AND ')}
      ORDER BY sequence_end DESC
      LIMIT 1;
    `;

    const result = await this.db.query<SummaryRow>(sql, params, { signal });
    const row = result.rows[0];
    return row ? mapSummary(row) : null;
  }

  public async saveSummary(summary: MemorySummary, signal?: AbortSignal): Promise<MemorySummary> {
    const sql = `
      INSERT INTO oicunt_memory.conversation_summaries (
        id, conversation_id, tenant_id, sequence_start, sequence_end,
        summary_text, token_estimate, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;
    const params = [
      summary.id,
      summary.conversationId,
      summary.tenantId,
      summary.sequenceStart,
      summary.sequenceEnd,
      summary.summaryText,
      summary.tokenEstimate,
      JSON.stringify(summary.metadata),
      summary.createdAt,
      summary.createdAt,
    ];

    const result = await this.db.query<SummaryRow>(sql, params, { signal });
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert summary');
    }
    return mapSummary(row);
  }

  public async purgeTenantOrUserData(
    tenantId: string,
    userId?: string,
    signal?: AbortSignal,
  ): Promise<PurgeResult> {
    return this.db.withTransaction(
      async (client) => {
        let countConvSql = `SELECT COUNT(*) as count FROM oicunt_memory.conversations WHERE tenant_id = $1`;
        let countMsgSql = `SELECT COUNT(*) as count FROM oicunt_memory.conversation_messages WHERE tenant_id = $1`;
        const countParams: unknown[] = [tenantId];

        if (userId) {
          countConvSql += ` AND user_id = $2`;
          countMsgSql += ` AND conversation_id IN (SELECT id FROM oicunt_memory.conversations WHERE tenant_id = $1 AND user_id = $2)`;
          countParams.push(userId);
        }

        const convCountRes = await client.query<{ count: string }>(countConvSql, countParams);
        const msgCountRes = await client.query<{ count: string }>(countMsgSql, countParams);

        const purgedConversations = Number.parseInt(convCountRes.rows[0]?.count ?? '0', 10);
        const purgedMessages = Number.parseInt(msgCountRes.rows[0]?.count ?? '0', 10);

        // Cascading DELETE on conversations physically removes corresponding messages and summaries
        let deleteSql = `DELETE FROM oicunt_memory.conversations WHERE tenant_id = $1`;
        const deleteParams: unknown[] = [tenantId];
        if (userId) {
          deleteSql += ` AND user_id = $2`;
          deleteParams.push(userId);
        }

        await client.query(deleteSql, deleteParams);

        return {
          tenantId,
          userId: userId ?? null,
          purgedConversations,
          purgedMessages,
        };
      },
      { signal },
    );
  }
}
