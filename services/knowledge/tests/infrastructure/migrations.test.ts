import { describe, expect, it } from 'vitest';
import { DatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import { DatabasePool } from '../../src/infrastructure/database/connection.js';

describe('Database Schema Migrations Specification for Knowledge Service', () => {
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

  it('creates oicunt_knowledge schema', () => {
    expect(initialMigration?.sql).toContain('CREATE SCHEMA IF NOT EXISTS oicunt_knowledge');
  });

  it('defines knowledge_collections table with tenant isolation and unique name constraint', () => {
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS oicunt_knowledge.knowledge_collections',
    );
    expect(initialMigration?.sql).toContain('tenant_id VARCHAR(64) NOT NULL');
    expect(initialMigration?.sql).toContain('embedding_model_id VARCHAR(128) NOT NULL');
    expect(initialMigration?.sql).toContain('embedding_dimensions INTEGER NOT NULL');
    expect(initialMigration?.sql).toContain(
      'CONSTRAINT uq_knowledge_collections_tenant_name UNIQUE (tenant_id, name)',
    );
  });

  it('defines knowledge_documents table with lifecycle status and hash deduplication constraint', () => {
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS oicunt_knowledge.knowledge_documents',
    );
    expect(initialMigration?.sql).toContain('tenant_id VARCHAR(64) NOT NULL');
    expect(initialMigration?.sql).toContain('collection_id VARCHAR(64) NOT NULL');
    expect(initialMigration?.sql).toContain('status VARCHAR(32) NOT NULL');
    expect(initialMigration?.sql).toContain('object_key VARCHAR(1024) NOT NULL');
    expect(initialMigration?.sql).toContain('document_hash VARCHAR(64) NOT NULL');
  });

  it('defines knowledge_chunks table with chunk sequence index and foreign key', () => {
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS oicunt_knowledge.knowledge_chunks',
    );
    expect(initialMigration?.sql).toContain('chunk_index INTEGER NOT NULL');
    expect(initialMigration?.sql).toContain('text TEXT NOT NULL');
    expect(initialMigration?.sql).toContain('token_estimate INTEGER NOT NULL');
    expect(initialMigration?.sql).toContain(
      'CONSTRAINT uq_knowledge_chunks_doc_index UNIQUE (document_id, chunk_index)',
    );
  });

  it('includes multi-tenant and status compound indexes', () => {
    expect(initialMigration?.sql).toContain('idx_kcollections_tenant');
    expect(initialMigration?.sql).toContain('idx_kdocs_tenant_collection');
    expect(initialMigration?.sql).toContain('idx_kdocs_tenant_status');
    expect(initialMigration?.sql).toContain('idx_kchunks_tenant_doc');
    expect(initialMigration?.sql).toContain('idx_kchunks_tenant_collection');
  });
});
