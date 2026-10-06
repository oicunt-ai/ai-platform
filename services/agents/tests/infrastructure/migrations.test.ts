import { describe, expect, it } from 'vitest';
import { DatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import type { DatabasePool } from '../../src/infrastructure/database/connection.js';

describe('Database Migrations', () => {
  it('discovers 001_initial_schema.sql and validates SQL structure', () => {
    const dummyPool = {} as DatabasePool;
    const migrator = new DatabaseMigrator(dummyPool);
    const files = migrator.getMigrationFiles();

    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]!.name).toBe('001_initial_schema.sql');
    expect(files[0]!.sql).toContain('CREATE SCHEMA IF NOT EXISTS oicunt_agents');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_agents.agents');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_agents.agent_versions');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_agents.agent_runs');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_agents.agent_steps');
    expect(files[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS oicunt_agents.agent_checkpoints');
  });
});
