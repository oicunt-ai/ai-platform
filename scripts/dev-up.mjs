/**
 * AI Platform development launcher: `pnpm dev`.
 *
 * Starts the five development services in dependency order with readiness
 * gating, then supervises them in the foreground until Ctrl+C. Node.js
 * standard library only; no process managers, no new dependencies.
 *
 * Safety: never migrates, seeds, registers, publishes usage, or touches
 * Docker. Never starts Platform Usage or the Platform Gateway (separate
 * repository). Refuses NODE_ENV=production. Binds loopback only.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEV_SERVICES,
  checkTcpOpen,
  formatMissingEnv,
  missingEnv,
  parseDotEnv,
  prefixLines,
  probeOnce,
  resolveTokenEnv,
  shutdownAll,
  startAll,
  watchChildren,
} from './dev-up-lib.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEALTH_TIMEOUT_MS = 60000;
const READY_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 1000;
const SHUTDOWN_GRACE_MS = 10000;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.log(
    [
      'Usage: pnpm dev',
      '',
      'Starts Model Registry (3001), Model Gateway (3002), Memory (3005),',
      'Inference (3004), and AI Orchestrator (3003) with readiness gating.',
      '',
      'Prerequisites: PostgreSQL + RabbitMQ via Docker Compose, a repo .env',
      'with INTERNAL_SERVICE_TOKEN and DATABASE_* set (see .env.example),',
      'and built services (`pnpm build`). Stays in the foreground;',
      'Ctrl+C stops services in reverse dependency order.',
    ].join('\n'),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }
  if (args.length > 0) {
    fail(`dev-up: unknown argument '${args[0]}' (see --help)`);
  }
  if (process.env['NODE_ENV'] === 'production') {
    fail('dev-up: refusing to run the development launcher with NODE_ENV=production');
  }

  let fileEnv = {};
  const envPath = join(REPO_ROOT, '.env');
  if (existsSync(envPath)) {
    fileEnv = parseDotEnv(readFileSync(envPath, 'utf8'));
  }
  // Explicit process environment always wins over the .env file.
  const env = { ...fileEnv, ...process.env };

  const missing = missingEnv(env);
  if (missing.length > 0) {
    fail(formatMissingEnv(missing));
  }
  const resolved = resolveTokenEnv(env);
  if (!resolved.ok) {
    fail(formatMissingEnv(resolved.missing));
  }

  for (const spec of DEV_SERVICES) {
    const entry = join(REPO_ROOT, spec.packageDir, spec.entry);
    if (!existsSync(entry)) {
      fail(
        `dev-up: missing compiled entrypoint ${spec.packageDir}/${spec.entry} ` +
          '(run pnpm build first)',
      );
    }
  }

  const dbTarget = `${env['DATABASE_HOST']}:${env['DATABASE_PORT']}`;
  if (!(await checkTcpOpen(env['DATABASE_HOST'], Number(env['DATABASE_PORT']), 3000))) {
    fail(
      `dev-up: database unreachable at ${dbTarget} ` +
        '(start Docker Compose first: docker compose -f infrastructure/docker/docker-compose.local.yml up -d)',
    );
  }

  const carries = new Map();
  const emit = (service, chunk) => {
    const state = carries.get(service) ?? '';
    const { lines, carry } = prefixLines(service, chunk, state);
    carries.set(service, carry);
    for (const line of lines) {
      console.log(line);
    }
  };

  const spawnService = (spec, childEnv) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, spec.packageDir, spec.entry)], {
      cwd: join(REPO_ROOT, spec.packageDir),
      env: { ...process.env, ...childEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => emit(spec.name, chunk));
    child.stderr.on('data', (chunk) => emit(spec.name, chunk));
    child.on('error', (error) => {
      console.log(`[dev-up] ${spec.name} spawn error: ${error.message}`);
    });
    return child;
  };

  const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
  const deps = {
    spawn: spawnService,
    checkPort: (port) => checkTcpOpen('127.0.0.1', port, 1000),
    probe: (url) => probeOnce(url, { timeoutMs: 5000 }),
    sleep,
    log: (line) => console.log(line),
    timeouts: { health: HEALTH_TIMEOUT_MS, ready: READY_TIMEOUT_MS },
    intervalMs: POLL_INTERVAL_MS,
  };
  const ctx = { env, tokens: resolved.mapping };

  let children;
  try {
    children = await startAll(deps, ctx);
  } catch (error) {
    fail(`dev-up: startup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let shuttingDown = false;
  const shutdown = async (signal, exitCode) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    detach();
    console.log(`[dev-up] ${signal} received, stopping services`);
    await shutdownAll(children, {
      sleep,
      log: (line) => console.log(line),
      graceMs: SHUTDOWN_GRACE_MS,
    });
    console.log('[dev-up] stopped');
    process.exit(exitCode);
  };
  const detach = watchChildren(children, (spec, code) => {
    if (shuttingDown) {
      return;
    }
    console.log(`[dev-up] ${spec.name} exited unexpectedly (code ${String(code)}), cleaning up`);
    void shutdown('failure', 1);
  });
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));

  console.log('[dev-up] all services ready; press Ctrl+C to stop');
  // Hold the foreground parent alive; children share this console.
  await new Promise(() => {
    // Intentionally never resolved; SIGINT/SIGTERM end the process.
  });
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    fail(`dev-up: ${error instanceof Error ? error.message : String(error)}`);
  }
}
