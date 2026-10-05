import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabasePool } from './connection.js';

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export class DatabaseMigrator {
  /** Deterministic 32-bit positive integer lock identifier for PostgreSQL advisory lock */
  public static readonly ADVISORY_LOCK_ID = 742918237;

  constructor(private readonly db: DatabasePool) {}

  public async runMigrations(): Promise<MigrationResult> {
    await this.ensureMigrationTable();

    // Acquire PostgreSQL advisory lock to prevent concurrent migrations across replicas
    await this.db.query('SELECT pg_advisory_lock($1)', [DatabaseMigrator.ADVISORY_LOCK_ID]);

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

        await this.db.withTransaction(async (client) => {
          await client.query(file.sql);
          await client.query('INSERT INTO model_registry._migrations (name) VALUES ($1)', [
            file.name,
          ]);
        });

        newlyApplied.push(file.name);
      }

      return {
        applied: Object.freeze(newlyApplied),
        alreadyApplied: Object.freeze(alreadyApplied),
      };
    } finally {
      await this.db.query('SELECT pg_advisory_unlock($1)', [DatabaseMigrator.ADVISORY_LOCK_ID]);
    }
  }

  private async ensureMigrationTable(): Promise<void> {
    await this.db.query('CREATE SCHEMA IF NOT EXISTS model_registry');
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS model_registry._migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  private async getAppliedMigrations(): Promise<Set<string>> {
    const res = await this.db.query<{ name: string }>(
      'SELECT name FROM model_registry._migrations ORDER BY name ASC',
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
      join(process.cwd(), 'services/model-registry/src/infrastructure/database/migrations'),
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
