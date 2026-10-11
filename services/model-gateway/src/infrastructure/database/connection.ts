import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * Connection configuration for the Model Gateway metering outbox database.
 *
 * The outbox lives in the shared OICUNT PostgreSQL cluster (`oicunt_ai`
 * database by default) but under a schema owned exclusively by the Model
 * Gateway migrator. The pool is created only when durable metering is
 * enabled; a disabled gateway never opens this connection.
 */
export interface OutboxDatabaseConfig {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly database?: string | undefined;
  readonly user?: string | undefined;
  readonly password?: string | undefined;
  readonly ssl?: boolean | { rejectUnauthorized?: boolean } | undefined;
  readonly maxConnections?: number | undefined;
  readonly idleTimeoutMillis?: number | undefined;
  readonly connectionTimeoutMillis?: number | undefined;
}

export class OutboxDatabasePool {
  private readonly pool: Pool;

  constructor(config: OutboxDatabaseConfig = {}) {
    this.pool = new Pool({
      host:
        config.host ?? process.env['OUTBOX_DB_HOST'] ?? process.env['DATABASE_HOST'] ?? 'localhost',
      port:
        config.port ??
        Number.parseInt(
          process.env['OUTBOX_DB_PORT'] ?? process.env['DATABASE_PORT'] ?? '5432',
          10,
        ),
      database:
        config.database ??
        process.env['OUTBOX_DB_NAME'] ??
        process.env['DATABASE_NAME'] ??
        'oicunt_ai',
      user:
        config.user ?? process.env['OUTBOX_DB_USER'] ?? process.env['DATABASE_USER'] ?? 'postgres',
      password:
        config.password ??
        process.env['OUTBOX_DB_PASSWORD'] ??
        process.env['DATABASE_PASSWORD'] ??
        '',
      ssl:
        config.ssl ??
        (process.env['DATABASE_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined),
      max: config.maxConnections ?? Number.parseInt(process.env['DATABASE_POOL_MAX'] ?? '10', 10),
      idleTimeoutMillis:
        config.idleTimeoutMillis ??
        Number.parseInt(process.env['DATABASE_IDLE_TIMEOUT_MS'] ?? '10000', 10),
      connectionTimeoutMillis:
        config.connectionTimeoutMillis ??
        Number.parseInt(process.env['DATABASE_CONN_TIMEOUT_MS'] ?? '3000', 10),
    });
  }

  public async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  public async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  public async ping(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as ping');
      return res.rowCount === 1;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}
