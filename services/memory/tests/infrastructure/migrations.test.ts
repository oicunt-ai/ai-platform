import { describe, expect, it } from 'vitest';
import { DatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import { DatabasePool } from '../../src/infrastructure/database/connection.js';

describe('Database Schema Migrations Specification for Memory Service', () => {
  const dummyPool = new DatabasePool({
    host: 'localhost',
    port: 5432,
    database: 'dummy',
    user: 'dummy',
  });
  const migrator = new DatabaseMigrator(dummyPool);
  const files = migrator.getMigrationFiles();
  const initialMigration = files.find((f) => f.name === '001_initial_schema.sql');

  it('loads migration files directly from migrations directory', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(initialMigration).toBeDefined();
  });

  it('creates oicunt_memory schema', () => {
    expect(initialMigration?.sql).toContain('CREATE SCHEMA IF NOT EXISTS oicunt_memory');
  });

  it('defines conversations table with tenant and user isolation', () => {
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS oicunt_memory.conversations',
    );
    expect(initialMigration?.sql).toContain('tenant_id VARCHAR(64) NOT NULL');
    expect(initialMigration?.sql).toContain('user_id VARCHAR(64) NOT NULL');
    expect(initialMigration?.sql).toContain("status VARCHAR(32) NOT NULL DEFAULT 'active'");
  });

  it('defines conversation_messages table with strictly increasing sequence unique constraint', () => {
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS oicunt_memory.conversation_messages',
    );
    expect(initialMigration?.sql).toContain('sequence_number INTEGER NOT NULL');
    expect(initialMigration?.sql).toContain(
      'CONSTRAINT uq_messages_conversation_sequence UNIQUE (conversation_id, sequence_number)',
    );
  });

  it('defines conversation_summaries table', () => {
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS oicunt_memory.conversation_summaries',
    );
    expect(initialMigration?.sql).toContain('sequence_start INTEGER NOT NULL');
    expect(initialMigration?.sql).toContain('sequence_end INTEGER NOT NULL');
    expect(initialMigration?.sql).toContain('summary_text TEXT NOT NULL');
  });

  it('includes compound indexes for multi-tenant queries and sliding windows', () => {
    expect(initialMigration?.sql).toContain('idx_conversations_tenant_user');
    expect(initialMigration?.sql).toContain('idx_messages_conversation_seq_desc');
    expect(initialMigration?.sql).toContain('idx_summaries_conv_seq_end');
  });
});
