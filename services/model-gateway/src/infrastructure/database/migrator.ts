import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import type { OutboxDatabasePool } from './connection.js';

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

/**
 * Explicit migration runner for the Model Gateway metering outbox schema.
 *
 * Runs ONLY through the standalone migrate entrypoint (`src/migrate.ts`,
 * `pnpm --filter @oicunt-ai/service-model-gateway migrate`). Ordinary
 * service startup never invokes this class: startup performs a read-only
 * schema compatibility check instead. Follows the established ai-platform
 * migrator pattern (advisory lock, `_migrations` ledger, schema ownership).
 */
export class OutboxDatabaseMigrator {
  /** Deterministic 32-bit positive integer lock identifier for PostgreSQL advisory lock */
  public static readonly ADVISORY_LOCK_ID = 982147563;

  public static readonly SCHEMA = 'model_gateway_outbox';

  constructor(private readonly db: OutboxDatabasePool) {}

  public async runMigrations(): Promise<MigrationResult> {
    const migrationFiles = this.getMigrationFiles();
    const client = await this.db.getClient();
    // Tracks whether the unlock outcome left cleanup UNCERTAIN (unlock
    // threw or the connection was lost). An uncertain session may still
    // hold the advisory lock and must be destroyed, never pooled.
    let unlockUncertain = false;
    try {
      await client.query('SELECT pg_advisory_lock($1)', [OutboxDatabaseMigrator.ADVISORY_LOCK_ID]);
      try {
        await this.ensureMigrationTable(client);
        const appliedSet = await this.getAppliedMigrations(client);

        const newlyApplied: string[] = [];
        const alreadyApplied: string[] = [];

        for (const file of migrationFiles) {
          if (appliedSet.has(file.name)) {
            alreadyApplied.push(file.name);
            continue;
          }

          try {
            await client.query('BEGIN');
            await client.query(file.sql);
            await client.query('INSERT INTO model_gateway_outbox._migrations (name) VALUES ($1)', [
              file.name,
            ]);
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }

          newlyApplied.push(file.name);
        }

        return {
          applied: Object.freeze(newlyApplied),
          alreadyApplied: Object.freeze(alreadyApplied),
        };
      } finally {
        // Unlock on the SAME session that acquired the lock. Three outcomes:
        // - true: released cleanly -> the client returns to the pool.
        // - false: this session provably holds no lock -> safe to pool.
        //   (Unreachable in practice — only this session ever touches the
        //   lock — but handled explicitly rather than assumed.)
        // - throw: cleanup UNCERTAIN, e.g. connection lost mid-unlock with
        //   the session possibly still alive and holding the lock.
        try {
          await client.query<{ pg_advisory_unlock: boolean }>('SELECT pg_advisory_unlock($1)', [
            OutboxDatabaseMigrator.ADVISORY_LOCK_ID,
          ]);
          // A `false` result means this session provably holds no lock, so
          // normal pooling below is safe. (Unreachable in practice — only
          // this session ever touches the lock — but the certain outcome
          // needs no special handling either way.)
        } catch {
          // Never mask the migration result: record uncertainty and let the
          // outer finally destroy the connection. A session-scoped lock dies
          // with its session, so destruction always cleans up.
          unlockUncertain = true;
        }
      }
    } finally {
      if (unlockUncertain) {
        // Destroy instead of pooling: a possibly lock-bearing session must
        // never be handed to another borrower (a pooled leak would make a
        // later migrator's blocking lock return instantly on the same
        // session, breaking mutual exclusion).
        client.release(
          new Error('Uncertain advisory-lock cleanup; destroying connection instead of pooling'),
        );
      } else {
        client.release();
      }
    }
  }

  private async ensureMigrationTable(client: PoolClient): Promise<void> {
    await client.query('CREATE SCHEMA IF NOT EXISTS model_gateway_outbox');
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_gateway_outbox._migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async getAppliedMigrations(client: PoolClient): Promise<Set<string>> {
    const res = await client.query<{ name: string }>(
      'SELECT name FROM model_gateway_outbox._migrations ORDER BY name ASC',
    );
    return new Set(res.rows.map((row) => row.name));
  }

  public getMigrationFiles(): Array<{ name: string; sql: string }> {
    const migrationsDir = this.resolveMigrationsDirectory();

    const fileNames = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    if (fileNames.length === 0) {
      throw new Error(`No SQL migration files found in directory '${migrationsDir}'`);
    }

    return fileNames.map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name), 'utf-8'),
    }));
  }

  private resolveMigrationsDirectory(): string {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(currentDir, 'migrations'),
      join(currentDir, '../../../src/infrastructure/database/migrations'),
      join(process.cwd(), 'services/model-gateway/src/infrastructure/database/migrations'),
      join(process.cwd(), 'src/infrastructure/database/migrations'),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `Failed to locate migration directory. Checked paths: ${candidates.join(', ')}`,
    );
  }
}
