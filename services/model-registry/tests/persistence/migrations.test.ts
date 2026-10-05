import { describe, expect, it } from 'vitest';
import { DatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import { DatabasePool } from '../../src/infrastructure/database/connection.js';

describe('Database Schema Migrations Specification', () => {
  const dummyPool = new DatabasePool({
    host: 'localhost',
    port: 5432,
    database: 'dummy',
    user: 'dummy',
  });
  const migrator = new DatabaseMigrator(dummyPool);
  const files = migrator.getMigrationFiles();
  const initialMigration = files.find((f) => f.name === '001_initial_schema.sql');

  it('loads migration files directly from authoritative migrations directory', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(initialMigration).toBeDefined();
  });

  it('contains model_registry schema creation', () => {
    expect(initialMigration?.sql).toContain('CREATE SCHEMA IF NOT EXISTS model_registry');
  });

  it('defines all 6 normalized relational tables required by contract', () => {
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS model_registry.canonical_models',
    );
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS model_registry.model_versions',
    );
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS model_registry.model_targets',
    );
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS model_registry.routing_policies',
    );
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS model_registry.model_aliases',
    );
    expect(initialMigration?.sql).toContain(
      'CREATE TABLE IF NOT EXISTS model_registry.audit_events',
    );
  });

  it('includes unique constraints on versions and aliases', () => {
    expect(initialMigration?.sql).toContain(
      'CONSTRAINT uq_canonical_model_version UNIQUE (canonical_model_id, version)',
    );
    expect(initialMigration?.sql).toContain('idx_uq_model_alias_global');
    expect(initialMigration?.sql).toContain('idx_uq_model_alias_tenant');
  });

  it('includes indexes on foreign keys and audit query paths', () => {
    expect(initialMigration?.sql).toContain('idx_model_versions_canonical_id');
    expect(initialMigration?.sql).toContain('idx_model_targets_version_id');
    expect(initialMigration?.sql).toContain('idx_audit_events_entity');
    expect(initialMigration?.sql).toContain('idx_audit_events_correlation');
  });
});
