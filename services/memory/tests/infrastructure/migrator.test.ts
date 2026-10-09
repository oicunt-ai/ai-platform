import { describe, expect, it } from 'vitest';
import { DatabaseMigrator } from '../../src/infrastructure/database/migrator.js';
import type { DatabasePool } from '../../src/infrastructure/database/connection.js';

describe('DatabaseMigrator - migration discovery', () => {
  it('discovers the initial schema and the turn checkpoint idempotency migration in order', () => {
    // getMigrationFiles only reads the migrations directory; no database is touched.
    const migrator = new DatabaseMigrator({} as DatabasePool);
    const files = migrator.getMigrationFiles();
    const names = files.map((file) => file.name);

    expect(names).toContain('001_initial_schema.sql');
    expect(names).toContain('002_turn_checkpoint_idempotency.sql');
    expect(names.indexOf('001_initial_schema.sql')).toBeLessThan(
      names.indexOf('002_turn_checkpoint_idempotency.sql'),
    );
  });

  it('backfills turn ordinals deterministically from sequence order', () => {
    const migrator = new DatabaseMigrator({} as DatabasePool);
    const migration = migrator
      .getMigrationFiles()
      .find((file) => file.name === '002_turn_checkpoint_idempotency.sql');

    expect(migration).toBeDefined();
    // Ordinals derive from ROW_NUMBER() over (conversation_id, turn_id)
    // ordered by sequence_number, so retries observe a stable order.
    expect(migration?.sql).toContain('ROW_NUMBER()');
    expect(migration?.sql).toContain('PARTITION BY conversation_id, turn_id');
    expect(migration?.sql).toContain('ORDER BY sequence_number ASC');
    expect(migration?.sql).toContain('uq_messages_conversation_turn_ordinal');
  });
});
