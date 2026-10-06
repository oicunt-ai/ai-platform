import { describe, expect, it } from 'vitest';
import { DatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import type { DatabasePool } from '../../src/infrastructure/database/connection.js';

describe('Tools Database Migrations', () => {
  it('discovers 001_initial_schema.sql and verifies valid DDL statements', () => {
    // Provide a dummy pool to test file discovery without establishing real network connection
    const migrator = new DatabaseMigrator({} as unknown as DatabasePool);
    const files = migrator.getMigrationFiles();

    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]!.name).toBe('001_initial_schema.sql');
    expect(files[0]!.sql).toContain('CREATE SCHEMA IF NOT EXISTS oicunt_tools');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_tools.tools');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_tools.tool_versions');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_tools.tenant_tool_configs');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_tools.tool_audit_logs');
    expect(files[0]!.sql).toContain(
      'CREATE TABLE IF NOT EXISTS oicunt_tools.tool_async_executions',
    );
  });
});
