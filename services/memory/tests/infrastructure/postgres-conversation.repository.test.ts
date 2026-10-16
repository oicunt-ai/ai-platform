import { describe, expect, it } from 'vitest';
import { ConversationNotFoundError, type Conversation } from '../../src/domain/index.js';
import type { DatabasePool } from '../../src/infrastructure/database/connection.js';
import { InMemoryConversationRepository } from '../../src/infrastructure/repositories/in-memory-conversation.repository.js';
import { PostgresConversationRepository } from '../../src/infrastructure/repositories/postgres-conversation.repository.js';

/**
 * Focused tests for `PostgresConversationRepository.updateConversation`.
 *
 * No PostgreSQL connection is opened: these use a `DatabasePool` double that
 * records the emitted SQL/params and applies the same shallow JSONB merge that
 * PostgreSQL's `metadata || $n::jsonb` performs. This pins the merge behaviour
 * against regression (metadata must not be replaced wholesale). Verifying the
 * expression against a real PostgreSQL instance requires a database and
 * migrations, which needs separate operator approval.
 */

const SEEDED_METADATA = { source: 'test', pinned: false, tags: ['a', 'b'] } as const;

function conversationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'conv_1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    title: 'Trip planning',
    status: 'active',
    metadata: { ...SEEDED_METADATA },
    message_count: 0,
    total_tokens_estimate: 0,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    last_message_at: null,
    retention_expires_at: null,
    deleted_at: null,
    ...overrides,
  };
}

interface RecordedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

/**
 * Database double that records every query and returns `rows`. Pass an empty
 * array to simulate a row that does not exist for the tenant.
 */
function recordingPool(rows: readonly Record<string, unknown>[]) {
  const queries: RecordedQuery[] = [];
  const db = {
    async query(text: string, params: readonly unknown[] = []) {
      queries.push({ text, params: [...params] });
      return { rows: [...rows], rowCount: rows.length, command: 'UPDATE', oid: 0, fields: [] };
    },
  };
  return { db: db as unknown as DatabasePool, queries };
}

/**
 * Database double that additionally applies the assignment the repository
 * emitted to a fixture row, mirroring PostgreSQL's shallow `jsonb || jsonb`
 * merge (right side wins at the top level).
 */
function simulatingPool(existingRow: Record<string, unknown>) {
  const queries: RecordedQuery[] = [];
  const db = {
    async query(text: string, params: readonly unknown[] = []) {
      queries.push({ text, params: [...params] });
      const row: Record<string, unknown> = { ...existingRow };

      const metadataMatch = text.match(
        /metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| \$(\d+)::jsonb/,
      );
      if (metadataMatch?.[1]) {
        const patch = JSON.parse(String(params[Number(metadataMatch[1]) - 1])) as Record<
          string,
          unknown
        >;
        row['metadata'] = { ...(row['metadata'] as Record<string, unknown>), ...patch };
      }
      const titleMatch = text.match(/title = \$(\d+)/);
      if (titleMatch?.[1]) {
        row['title'] = params[Number(titleMatch[1]) - 1];
      }

      return { rows: [row], rowCount: 1, command: 'UPDATE', oid: 0, fields: [] };
    },
  };
  return { db: db as unknown as DatabasePool, queries };
}

describe('PostgresConversationRepository.updateConversation', () => {
  it('merges metadata in SQL instead of replacing the JSONB column', async () => {
    const { db, queries } = recordingPool([conversationRow()]);
    const repository = new PostgresConversationRepository(db);

    await repository.updateConversation('tenant-1', 'conv_1', { metadata: { pinned: true } });

    const sql = queries[0]?.text ?? '';
    expect(sql).toContain(`COALESCE(metadata, '{}'::jsonb) || $3::jsonb`);
    // Regression guard: a bare `metadata = $n` would replace the whole column.
    expect(sql).not.toMatch(/metadata = \$\d+(?!::jsonb)/);
  });

  it('retains unrelated metadata fields when only pinned changes', async () => {
    const { db } = simulatingPool(conversationRow());
    const repository = new PostgresConversationRepository(db);

    const updated = await repository.updateConversation('tenant-1', 'conv_1', {
      metadata: { pinned: true },
    });

    expect(updated.metadata).toEqual({ source: 'test', pinned: true, tags: ['a', 'b'] });
  });

  it('preserves metadata on a title-only update', async () => {
    const { db, queries } = simulatingPool(conversationRow());
    const repository = new PostgresConversationRepository(db);

    const updated = await repository.updateConversation('tenant-1', 'conv_1', { title: 'Renamed' });

    expect(queries[0]?.text).not.toContain('metadata =');
    expect(updated.title).toBe('Renamed');
    expect(updated.metadata).toEqual(SEEDED_METADATA);
  });

  it('keeps the update scoped to id and tenant, and reports a missing row as not found', async () => {
    const { db, queries } = recordingPool([]);
    const repository = new PostgresConversationRepository(db);

    await expect(
      repository.updateConversation('tenant-2', 'conv_1', { metadata: { pinned: true } }),
    ).rejects.toThrow(ConversationNotFoundError);

    const sql = queries[0]?.text ?? '';
    expect(sql).toContain('WHERE id = $1 AND tenant_id = $2');
    expect(queries[0]?.params.slice(0, 2)).toEqual(['conv_1', 'tenant-2']);
  });

  it('keeps the metadata patch parameterized rather than inlined', async () => {
    const { db, queries } = recordingPool([conversationRow()]);
    const repository = new PostgresConversationRepository(db);

    await repository.updateConversation('tenant-1', 'conv_1', {
      title: 'Roadmap',
      metadata: { pinned: true },
    });

    const query = queries[0];
    expect(query?.text).not.toContain('pinned');
    expect(query?.text).not.toContain('Roadmap');
    expect(query?.params).toEqual([
      'conv_1',
      'tenant-1',
      'Roadmap',
      JSON.stringify({ pinned: true }),
    ]);
  });

  it('produces the same metadata as the in-memory repository for the same patch', async () => {
    const seeded: Conversation = {
      id: 'conv_1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      title: 'Trip planning',
      status: 'active',
      metadata: { ...SEEDED_METADATA },
      messageCount: 0,
      totalTokensEstimate: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastMessageAt: null,
      retentionExpiresAt: null,
      deletedAt: null,
    };

    const inMemory = new InMemoryConversationRepository();
    await inMemory.createConversation(seeded);
    const fromMemory = await inMemory.updateConversation('tenant-1', 'conv_1', {
      metadata: { pinned: true },
    });

    const { db } = simulatingPool(conversationRow());
    const fromPostgres = await new PostgresConversationRepository(db).updateConversation(
      'tenant-1',
      'conv_1',
      { metadata: { pinned: true } },
    );

    expect(fromPostgres.metadata).toEqual(fromMemory.metadata);
  });
});
