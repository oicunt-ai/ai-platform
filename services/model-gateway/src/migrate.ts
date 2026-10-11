import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OutboxDatabasePool } from './infrastructure/database/connection.js';
import { loadModelGatewayConfig } from './config.js';
import { OutboxDatabaseMigrator } from './infrastructure/database/migrator.js';

/**
 * Explicit Model Gateway metering-outbox migration entrypoint:
 * `pnpm --filter @oicunt-ai/service-model-gateway migrate`.
 *
 * Applies pending migrations for the `model_gateway_outbox` schema and
 * exits. This is the ONLY supported way to change the outbox schema;
 * routine service startup never migrates (see service start(), which
 * performs a read-only compatibility check instead).
 */
async function main(): Promise<void> {
  const config = loadModelGatewayConfig();
  const pool = new OutboxDatabasePool({
    host: config.outboxDatabase.host,
    port: config.outboxDatabase.port,
    database: config.outboxDatabase.database,
    user: config.outboxDatabase.user,
    password: config.outboxDatabase.password,
  });
  try {
    const result = await new OutboxDatabaseMigrator(pool).runMigrations();
    // Counts only: never log schema contents or credentials.
    console.log(
      `[model-gateway] outbox migrations applied=${result.applied.length} ` +
        `already-applied=${result.alreadyApplied.length}`,
    );
  } catch (error) {
    console.error(
      `[model-gateway] outbox migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  } finally {
    await pool.close().catch(() => {
      // Best effort during shutdown.
    });
  }
}

// Entrypoint only: importing this module must never migrate as a side effect.
const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main();
}
