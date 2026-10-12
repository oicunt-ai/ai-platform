import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OutboxDatabasePool } from './infrastructure/database/connection.js';
import { requireExplicitOutboxTarget, type ExplicitOutboxTarget } from './config.js';
import { OutboxDatabaseMigrator } from './infrastructure/database/migrator.js';

export interface MigrateOutboxOptions {
  /** Environment source for destination resolution. Defaults to process.env. */
  readonly env?: Record<string, string | undefined> | undefined;
  /** Pool factory (tests inject fakes; production uses OutboxDatabasePool). */
  readonly createPool?: ((target: ExplicitOutboxTarget) => OutboxDatabasePool) | undefined;
  readonly log?: ((line: string) => void) | undefined;
  readonly logError?: ((line: string) => void) | undefined;
}

/**
 * Explicit Model Gateway metering-outbox migration entrypoint:
 * `pnpm --filter @oicunt-ai/service-model-gateway migrate`
 * (the package script loads the repository .env deterministically via
 * `node --env-file`, without printing or persisting secrets).
 *
 * Applies pending migrations for the `model_gateway_outbox` schema and
 * exits. This is the ONLY supported way to change the outbox schema;
 * routine service startup never migrates (see service start(), which
 * performs a read-only compatibility check instead).
 *
 * Safety contract, in order:
 * 1. The destination (host, port, database, user, password) must be
 *    explicitly configured — no localhost:5432-style silent defaults.
 * 2. The target (never credentials) is logged before any DDL.
 * 3. The live connection identity (server version, current database,
 *    current user) is verified read-only; a database mismatch refuses.
 * 4. Migrations run on one dedicated advisory-locked client.
 */
export async function runOutboxMigration(options: MigrateOutboxOptions = {}): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line));
  const logError = options.logError ?? ((line: string) => console.error(line));
  let pool: OutboxDatabasePool | undefined;
  try {
    const target = requireExplicitOutboxTarget(options.env);
    // Host, port, database, user only: the password is never logged.
    log(
      `[model-gateway] migrating outbox schema on ${target.host}:${target.port}/${target.database} as ${target.user}`,
    );
    pool =
      options.createPool?.(target) ??
      new OutboxDatabasePool({
        host: target.host,
        port: target.port,
        database: target.database,
        user: target.user,
        password: target.password,
      });
    const identity = await pool.query<{ version: string; database: string; user: string }>(
      'SELECT version() AS version, current_database() AS database, current_user AS "user"',
    );
    const row = identity.rows[0];
    if (!row || row.database !== target.database) {
      throw new Error(
        `Connected database '${row?.database ?? 'unknown'}' does not match configured migration target '${target.database}'; refusing to migrate`,
      );
    }
    log(
      `[model-gateway] connected: ${(row.version ?? '').split(' ').slice(0, 2).join(' ')} as ${row.user}`,
    );
    const result = await new OutboxDatabaseMigrator(pool).runMigrations();
    // Counts only: never log schema contents or credentials.
    log(
      `[model-gateway] outbox migrations applied=${result.applied.length} ` +
        `already-applied=${result.alreadyApplied.length}`,
    );
  } catch (error) {
    logError(
      `[model-gateway] outbox migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    await pool?.close().catch(() => {
      // Best effort during shutdown.
    });
  }
}

async function main(): Promise<void> {
  await runOutboxMigration();
}

// Entrypoint only: importing this module must never migrate as a side effect.
const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
