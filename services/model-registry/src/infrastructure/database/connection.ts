import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export interface DatabasePoolConfig {
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

export class DatabasePool {
  private readonly pool: Pool;

  constructor(config: DatabasePoolConfig = {}) {
    this.pool = new Pool({
      host: config.host ?? process.env['DATABASE_HOST'] ?? 'localhost',
      port: config.port ?? Number.parseInt(process.env['DATABASE_PORT'] ?? '5432', 10),
      database: config.database ?? process.env['DATABASE_NAME'] ?? 'oicunt_ai',
      user: config.user ?? process.env['DATABASE_USER'] ?? 'postgres',
      password: config.password ?? process.env['DATABASE_PASSWORD'] ?? '',
      ssl:
        config.ssl ??
        (process.env['DATABASE_SSL'] === 'true' ? { rejectUnauthorized: false } : undefined),
      max: config.maxConnections ?? Number.parseInt(process.env['DATABASE_POOL_MAX'] ?? '20', 10),
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

  public async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
