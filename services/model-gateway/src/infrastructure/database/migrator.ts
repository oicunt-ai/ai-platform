import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    await this.ensureMigrationTable();

    // Acquire PostgreSQL advisory lock to prevent concurrent migrations across replicas
    await this.db.query('SELECT pg_advisory_lock($1)', [OutboxDatabaseMigrator.ADVISORY_LOCK_ID]);

    try {
      const appliedSet = await this.getAppliedMigrations();
      const migrationFiles = this.getMigrationFiles();

      const newlyApplied: string[] = [];
      const alreadyApplied: string[] = [];

      for (const file of migrationFiles) {
        if (appliedSet.has(file.name)) {
          alreadyApplied.push(file.name);
          continue;
        }

        const client = await this.db.getClient();
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
        } finally {
          client.release();
        }

        newlyApplied.push(file.name);
      }

      return {
        applied: Object.freeze(newlyApplied),
        alreadyApplied: Object.freeze(alreadyApplied),
      };
    } finally {
      await this.db.query('SELECT pg_advisory_unlock($1)', [
        OutboxDatabaseMigrator.ADVISORY_LOCK_ID,
      ]);
    }
  }

  private async ensureMigrationTable(): Promise<void> {
    await this.db.query('CREATE SCHEMA IF NOT EXISTS model_gateway_outbox');
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS model_gateway_outbox._migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async getAppliedMigrations(): Promise<Set<string>> {
    const res = await this.db.query<{ name: string }>(
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
