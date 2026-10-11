import type { OutboxDatabasePool } from './connection.js';

export interface OutboxCompatibilityReport {
  readonly compatible: boolean;
  /** Human-readable problem descriptions; empty when compatible. */
  readonly problems: readonly string[];
}

/** Columns the outbox store and drainer depend on. */
const REQUIRED_COLUMNS = [
  'outbox_id',
  'event_id',
  'tenant_id',
  'idempotency_key',
  'event',
  'status',
  'attempts',
  'next_attempt_at',
  'lease_owner',
  'lease_expires_at',
  'last_error',
  'captured_at',
  'confirmed_at',
] as const;

/**
 * Read-only schema compatibility verification for the metering outbox.
 *
 * Confirms that the `model_gateway_outbox.metering_outbox` table exists
 * with every column this build depends on. Issues SELECT/catalog queries
 * only: no DDL, no migrations, no writes. Ordinary service startup calls
 * this when durable metering is enabled and refuses to start when the
 * schema does not match, instead of running migrations.
 */
export async function verifyMeteringOutboxCompatibility(
  db: OutboxDatabasePool,
): Promise<OutboxCompatibilityReport> {
  const problems: string[] = [];

  let tablePresent: boolean;
  try {
    const table = await db.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'model_gateway_outbox' AND table_name = 'metering_outbox'
       ) AS present`,
    );
    tablePresent = table.rows[0]?.present === true;
  } catch (err) {
    return {
      compatible: false,
      problems: [
        `metering outbox schema is unreachable: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (!tablePresent) {
    return {
      compatible: false,
      problems: [
        "required table 'model_gateway_outbox.metering_outbox' is missing " +
          "(run 'pnpm --filter @oicunt-ai/service-model-gateway migrate')",
      ],
    };
  }

  const columns = await db.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'model_gateway_outbox' AND table_name = 'metering_outbox'`,
  );
  const present = new Set(columns.rows.map((row) => row.column_name));
  for (const column of REQUIRED_COLUMNS) {
    if (!present.has(column)) {
      problems.push(`required column 'model_gateway_outbox.metering_outbox.${column}' is missing`);
    }
  }

  return { compatible: problems.length === 0, problems };
}
