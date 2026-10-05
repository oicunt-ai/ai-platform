import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DatabasePool } from '../../src/infrastructure/database/connection.js';

export interface TestPostgresInstance {
  readonly pool: DatabasePool;
  readonly cleanup: () => Promise<void>;
}

function findPostgresBinDir(): string | null {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const winDirs = [
      'C:\\Program Files\\PostgreSQL\\17\\bin',
      'C:\\Program Files\\PostgreSQL\\16\\bin',
      'C:\\Program Files\\PostgreSQL\\15\\bin',
    ];
    for (const d of winDirs) {
      if (existsSync(join(d, 'initdb.exe')) && existsSync(join(d, 'pg_ctl.exe'))) {
        return d;
      }
    }
  }

  // Check PATH
  const check = spawnSync(isWindows ? 'where' : 'which', ['initdb'], {
    encoding: 'utf-8',
    stdio: 'pipe',
  });
  if (check.status === 0 && check.stdout.trim().length > 0) {
    const firstLine = check.stdout.trim().split(/\r?\n/)[0];
    if (firstLine) {
      const idx = firstLine.lastIndexOf(isWindows ? '\\' : '/');
      return idx > 0 ? firstLine.slice(0, idx) : null;
    }
  }

  return null;
}

async function getAvailablePort(startPort = 15432): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(startPort, '127.0.0.1', () => {
      server.close(() => {
        resolve(startPort);
      });
    });
    server.on('error', () => {
      resolve(getAvailablePort(startPort + 1));
    });
  });
}

export async function setupTestPostgres(): Promise<TestPostgresInstance | null> {
  // 1. Environment-specified test database URL (e.g. CI service container)
  const testUrl = process.env['TEST_DATABASE_URL'];
  if (testUrl) {
    const parsed = new URL(testUrl);
    const pool = new DatabasePool({
      host: parsed.hostname,
      port: Number.parseInt(parsed.port || '5432', 10),
      database: parsed.pathname.replace(/^\//, '') || 'postgres',
      user: parsed.username || 'postgres',
      password: parsed.password || '',
      maxConnections: 5,
    });
    return {
      pool,
      cleanup: async () => {
        await pool.close();
      },
    };
  }

  // 2. Ephemeral local PostgreSQL cluster via initdb / pg_ctl
  const binDir = findPostgresBinDir();
  if (!binDir) {
    return null;
  }

  const isWindows = process.platform === 'win32';
  const initDbExe = join(binDir, isWindows ? 'initdb.exe' : 'initdb');
  const pgCtlExe = join(binDir, isWindows ? 'pg_ctl.exe' : 'pg_ctl');

  const testDir = join(
    tmpdir(),
    `oicunt_pg_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
  );
  const port = await getAvailablePort(15432);

  // Initialize cluster with trust authentication
  const initRes = spawnSync(
    initDbExe,
    ['-D', testDir, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'],
    { stdio: 'ignore' },
  );

  if (initRes.status !== 0) {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on abort
    }
    return null;
  }

  // Start cluster
  const logFile = join(testDir, 'pg.log');
  const startRes = spawnSync(
    pgCtlExe,
    ['-D', testDir, '-o', `-p ${port}`, '-l', logFile, '-w', 'start'],
    { stdio: 'ignore' },
  );

  if (startRes.status !== 0) {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error on abort
    }
    return null;
  }

  const pool = new DatabasePool({
    host: '127.0.0.1',
    port,
    database: 'postgres',
    user: 'postgres',
    maxConnections: 10,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });

  return {
    pool,
    cleanup: async () => {
      try {
        await pool.close();
      } catch {
        // Ignore pool close error during cleanup
      }
      try {
        spawnSync(pgCtlExe, ['-D', testDir, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
      } catch {
        // Ignore pg_ctl stop error
      }
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore temp directory deletion error
      }
    },
  };
}
