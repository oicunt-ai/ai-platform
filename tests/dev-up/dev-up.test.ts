/**
 * Focused tests for the development launcher core (`scripts/dev-up-lib.mjs`).
 *
 * All I/O is faked: mock child processes, scripted probes, a fake clock.
 * The only real I/O is a loopback TCP open/close pair for checkTcpOpen.
 * Fixture secrets are throwaway values; one test asserts they never leak
 * into launcher log output.
 */
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  DEV_SERVICES,
  REQUIRED_ENV,
  buildChildEnv,
  checkTcpOpen,
  formatMissingEnv,
  formatPortConflict,
  healthUrl,
  missingEnv,
  parseDotEnv,
  prefixLines,
  probeOnce,
  readyUrl,
  resolveTokenEnv,
  serviceBaseUrl,
  shutdownAll,
  shutdownOrder,
  startAll,
  waitFor,
  watchChildren,
  type ChildRef,
  type ServiceSpec,
  type StartedService,
} from '../../scripts/dev-up-lib.mjs';

const SHARED_TOKEN = 'test-shared-token-value';
const DB_ENV: Record<string, string> = {
  INTERNAL_SERVICE_TOKEN: SHARED_TOKEN,
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '5433',
  DATABASE_USER: 'postgres',
  DATABASE_PASSWORD: 'test-password-value',
};
const TOKENS: Record<string, string> = (() => {
  const resolved = resolveTokenEnv({ ...DB_ENV });
  if (!resolved.ok) {
    throw new Error('fixture tokens must resolve');
  }
  return resolved.mapping;
})();

function fakeClock() {
  let nowValue = 0;
  return {
    now: () => nowValue,
    sleep: async (ms: number) => {
      nowValue += ms;
    },
  };
}

interface MockChild extends ChildRef {
  readonly killed: string[];
  die: (code: number | null) => void;
  emitExit: (code: unknown) => void;
}

function mockChild(pid: number, autoExit: boolean): MockChild {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const child: MockChild = {
    pid,
    exitCode: null,
    killed: [],
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== listener),
      );
    },
    kill: (signal: string) => {
      child.killed.push(signal);
      if (autoExit) {
        child.die(0);
      }
      return true;
    },
    die: (code: number | null) => {
      child.exitCode = code;
      for (const listener of listeners.get('exit') ?? []) {
        listener(code, null);
      }
    },
    emitExit: (code: unknown) => {
      for (const listener of listeners.get('exit') ?? []) {
        listener(code, null);
      }
    },
  };
  return child;
}

function scriptedProbe(script: Array<number | null>) {
  let calls = 0;
  const probe = async (_url: string): Promise<number | null> => {
    const index = Math.min(calls, script.length - 1);
    calls += 1;
    return script[index] ?? null;
  };
  return { probe, calls: () => calls };
}

describe('service table', () => {
  it('contains exactly the five development services in dependency order', () => {
    expect(DEV_SERVICES.map((s) => `${s.name}:${s.port}`)).toEqual([
      'registry:3001',
      'model-gateway:3002',
      'memory:3005',
      'inference:3004',
      'orchestrator:3003',
    ]);
    const names = DEV_SERVICES.map((s) => s.name);
    expect(names).not.toContain('usage');
    expect(names).not.toContain('gateway');
  });

  it('builds loopback health URLs', () => {
    expect(serviceBaseUrl(3001)).toBe('http://127.0.0.1:3001');
    expect(healthUrl(3001)).toBe('http://127.0.0.1:3001/healthz');
    expect(readyUrl(3001)).toBe('http://127.0.0.1:3001/readyz');
  });
});

describe('environment handling', () => {
  it('parses KEY=VALUE files and skips noise', () => {
    expect(
      parseDotEnv('# comment\n\nPORT=3001\nEMPTY=\nBAD LINE\nA1_B2=x=y\n  SPACED = v \n'),
    ).toEqual({ PORT: '3001', EMPTY: '', A1_B2: 'x=y', SPACED: 'v' });
  });

  it('reports every missing required variable by name', () => {
    expect(missingEnv({})).toEqual([...REQUIRED_ENV]);
    expect(missingEnv({ ...DB_ENV })).toEqual([]);
    expect(missingEnv({ ...DB_ENV, DATABASE_PASSWORD: '   ' })).toEqual(['DATABASE_PASSWORD']);
    expect(formatMissingEnv(['A', 'B'])).toContain('A, B');
  });

  it('maps the shared token onto pair-specific names', () => {
    const resolved = resolveTokenEnv({ ...DB_ENV });
    if (!resolved.ok) {
      throw new Error('expected ok');
    }
    for (const name of [
      'INTERNAL_SERVICE_TOKEN',
      'INTERNAL_SERVICE_SECRET',
      'INTERNAL_AUTH_TOKEN',
      'MODEL_REGISTRY_INTERNAL_TOKEN',
      'MODEL_GATEWAY_INTERNAL_TOKEN',
      'INFERENCE_INTERNAL_TOKEN',
      'MEMORY_INTERNAL_TOKEN',
      'AI_ORCHESTRATOR_INTERNAL_TOKEN',
    ]) {
      expect(resolved.mapping[name]).toBe(SHARED_TOKEN);
    }
    expect(resolveTokenEnv({})).toEqual({
      ok: false,
      missing: ['INTERNAL_SERVICE_TOKEN'],
    });
  });

  it('builds per-service environments from real contracts', () => {
    const byName = new Map(DEV_SERVICES.map((s) => [s.name, s]));
    const registry = byName.get('registry');
    const orchestrator = byName.get('orchestrator');
    const modelGateway = byName.get('model-gateway');
    const inference = byName.get('inference');
    if (!registry || !orchestrator || !modelGateway || !inference) {
      throw new Error('table incomplete');
    }
    const regEnv = buildChildEnv(registry, {
      env: { ...DB_ENV, NODE_ENV: '', LOG_LEVEL: 'debug' },
      tokens: TOKENS,
    });
    expect(regEnv['PORT']).toBe('3001');
    expect(regEnv['HOST']).toBe('127.0.0.1');
    expect(regEnv['NODE_ENV']).toBe('development');
    expect(regEnv['DATABASE_NAME']).toBe('oicunt_ai');
    expect(regEnv['DATABASE_HOST']).toBe('127.0.0.1');
    expect(regEnv['MODEL_REGISTRY_INTERNAL_TOKEN']).toBe(SHARED_TOKEN);
    expect(regEnv['LOG_LEVEL']).toBe('debug');
    expect(regEnv['INFERENCE_BASE_URL']).toBeUndefined();

    const orchEnv = buildChildEnv(orchestrator, {
      env: { ...DB_ENV, NODE_ENV: 'staging' },
      tokens: TOKENS,
    });
    expect(orchEnv['NODE_ENV']).toBe('staging');
    expect(orchEnv['MODEL_REGISTRY_BASE_URL']).toBe('http://127.0.0.1:3001');
    expect(orchEnv['INFERENCE_BASE_URL']).toBe('http://127.0.0.1:3004');
    expect(orchEnv['MEMORY_BASE_URL']).toBe('http://127.0.0.1:3005');
    expect(orchEnv['DATABASE_HOST']).toBeUndefined();

    const gwEnv = buildChildEnv(modelGateway, {
      env: { ...DB_ENV, GROQ_API_KEY: 'k', RABBITMQ_URL: 'amqp://x' },
      tokens: TOKENS,
    });
    expect(gwEnv['GROQ_API_KEY']).toBe('k');
    expect(gwEnv['RABBITMQ_URL']).toBe('amqp://x');
    const gwBare = buildChildEnv(modelGateway, { env: { ...DB_ENV }, tokens: TOKENS });
    expect(gwBare['GROQ_API_KEY']).toBeUndefined();

    const infEnv = buildChildEnv(inference, {
      env: { ...DB_ENV, MODEL_GATEWAY_BASE_URL: 'http://example.test:9999' },
      tokens: TOKENS,
    });
    expect(infEnv['MODEL_GATEWAY_BASE_URL']).toBe('http://example.test:9999');
  });

  it('respects operator-set pair tokens over the shared value', () => {
    const registry = DEV_SERVICES[0];
    if (!registry) {
      throw new Error('table incomplete');
    }
    const env = buildChildEnv(registry, {
      env: { ...DB_ENV, MODEL_REGISTRY_INTERNAL_TOKEN: 'operator-value' },
      tokens: { ...TOKENS, MODEL_REGISTRY_INTERNAL_TOKEN: 'operator-value' },
    });
    expect(env['MODEL_REGISTRY_INTERNAL_TOKEN']).toBe('operator-value');
  });
});

describe('model gateway metering forwarding', () => {
  // Mirrors MODEL_GATEWAY_METERING_KEYS in scripts/dev-up-lib.mjs. Kept as a
  // literal here so the test file needs no change to the launcher's .d.mts
  // contract surface; test 9 below asserts the full set is forwarded.
  const METERING_KEYS = [
    'ENABLE_USAGE_PUBLISHING',
    'OUTBOX_DB_HOST',
    'OUTBOX_DB_PORT',
    'OUTBOX_DB_NAME',
    'OUTBOX_DB_USER',
    'OUTBOX_DB_PASSWORD',
    'METERING_CAPTURE_TIMEOUT_MS',
    'METERING_CAPTURE_CHECK_INTERVAL_MS',
    'OUTBOX_DRAIN_BATCH_SIZE',
    'OUTBOX_DRAIN_CONCURRENCY',
    'OUTBOX_DRAIN_MAX_ATTEMPTS',
    'OUTBOX_DRAIN_BASE_DELAY_MS',
    'OUTBOX_DRAIN_MAX_DELAY_MS',
    'OUTBOX_DRAIN_LEASE_MS',
    'OUTBOX_DRAIN_POLL_MS',
    'METERING_PUBLISH_CONFIRM_TIMEOUT_MS',
    'METERING_RECONNECT_INITIAL_MS',
    'METERING_RECONNECT_MAX_MS',
    'USAGE_RABBITMQ_EXCHANGE',
    'MAX_ATTEMPTS_PER_TARGET',
    'MAX_TOTAL_EXECUTION_ATTEMPTS',
    'MAX_FALLBACK_ATTEMPTS',
  ];
  const FAKE_OUTBOX_DB: Record<string, string> = {
    OUTBOX_DB_HOST: '127.0.0.1',
    OUTBOX_DB_PORT: '5433',
    OUTBOX_DB_NAME: 'oicunt_ai',
    OUTBOX_DB_USER: 'fake-outbox-user',
    OUTBOX_DB_PASSWORD: 'fake-outbox-password-xyz',
  };
  const FAKE_TUNING: Record<string, string> = {
    METERING_CAPTURE_TIMEOUT_MS: '2000',
    METERING_CAPTURE_CHECK_INTERVAL_MS: '15000',
    OUTBOX_DRAIN_BATCH_SIZE: '50',
    OUTBOX_DRAIN_CONCURRENCY: '5',
    OUTBOX_DRAIN_MAX_ATTEMPTS: '20',
    OUTBOX_DRAIN_BASE_DELAY_MS: '1000',
    OUTBOX_DRAIN_MAX_DELAY_MS: '300000',
    OUTBOX_DRAIN_LEASE_MS: '300000',
    OUTBOX_DRAIN_POLL_MS: '1000',
    METERING_PUBLISH_CONFIRM_TIMEOUT_MS: '10000',
    METERING_RECONNECT_INITIAL_MS: '1000',
    METERING_RECONNECT_MAX_MS: '30000',
  };
  const FAKE_SINGLE_ATTEMPT: Record<string, string> = {
    MAX_ATTEMPTS_PER_TARGET: '1',
    MAX_TOTAL_EXECUTION_ATTEMPTS: '1',
    MAX_FALLBACK_ATTEMPTS: '0',
  };

  function gatewaySpec(): ServiceSpec {
    const spec = DEV_SERVICES.find((s) => s.name === 'model-gateway');
    if (!spec) {
      throw new Error('model-gateway spec missing');
    }
    return spec;
  }

  function otherSpecs(): ServiceSpec[] {
    return DEV_SERVICES.filter((s) => s.name !== 'model-gateway');
  }

  function gatewayEnv(extra: Record<string, string> = {}): Record<string, string> {
    return buildChildEnv(gatewaySpec(), { env: { ...DB_ENV, ...extra }, tokens: TOKENS });
  }

  it('1. forwards .env publishing=true to Model Gateway', () => {
    expect(gatewayEnv({ ENABLE_USAGE_PUBLISHING: 'true' })['ENABLE_USAGE_PUBLISHING']).toBe('true');
  });

  it('2. forwards publishing=false unchanged', () => {
    expect(gatewayEnv({ ENABLE_USAGE_PUBLISHING: 'false' })['ENABLE_USAGE_PUBLISHING']).toBe(
      'false',
    );
  });

  it('3. keeps absent publishing settings absent', () => {
    const overlay = gatewayEnv();
    for (const name of METERING_KEYS) {
      expect(overlay[name], name).toBeUndefined();
    }
  });

  it('4. lets process environment override the .env value', () => {
    // buildChildEnv receives the already-merged launcher environment, in
    // which process values win; the overlay must echo the merged value
    // verbatim rather than re-reading any source.
    expect(
      gatewayEnv({ ENABLE_USAGE_PUBLISHING: 'false', EXTRA_MERGED: 'yes' })[
        'ENABLE_USAGE_PUBLISHING'
      ],
    ).toBe('false');
    expect(gatewayEnv({ ENABLE_USAGE_PUBLISHING: 'TRUE' })['ENABLE_USAGE_PUBLISHING']).toBe('TRUE');
  });

  it('5. passes invalid activation values through for the gateway parser', () => {
    // The launcher must not normalize or reject; the gateway config parser
    // owns validation and fails closed on anything but true/false.
    expect(gatewayEnv({ ENABLE_USAGE_PUBLISHING: 'maybe' })['ENABLE_USAGE_PUBLISHING']).toBe(
      'maybe',
    );
  });

  it('6. forwards all five OUTBOX_DB_* settings to Model Gateway', () => {
    const overlay = gatewayEnv({ ...FAKE_OUTBOX_DB });
    for (const [name, value] of Object.entries(FAKE_OUTBOX_DB)) {
      expect(overlay[name], name).toBe(value);
    }
  });

  it('7. keeps outbox settings out of unrelated service overlays', () => {
    for (const spec of otherSpecs()) {
      const overlay = buildChildEnv(spec, {
        env: { ...DB_ENV, ...FAKE_OUTBOX_DB },
        tokens: TOKENS,
      });
      for (const name of Object.keys(FAKE_OUTBOX_DB)) {
        expect(overlay[name], `${spec.name}:${name}`).toBeUndefined();
      }
      expect(overlay['ENABLE_USAGE_PUBLISHING'], spec.name).toBeUndefined();
    }
  });

  it('8. forwards temporary single-attempt configuration', () => {
    const overlay = gatewayEnv({ ...FAKE_SINGLE_ATTEMPT });
    expect(overlay['MAX_ATTEMPTS_PER_TARGET']).toBe('1');
    expect(overlay['MAX_TOTAL_EXECUTION_ATTEMPTS']).toBe('1');
    expect(overlay['MAX_FALLBACK_ATTEMPTS']).toBe('0');
  });

  it('9. forwards drainer, publisher, capture and routing tuning', () => {
    const overlay = gatewayEnv({ ...FAKE_TUNING, USAGE_RABBITMQ_EXCHANGE: 'oicunt.usage' });
    for (const [name, value] of Object.entries({
      ...FAKE_TUNING,
      USAGE_RABBITMQ_EXCHANGE: 'oicunt.usage',
    })) {
      expect(overlay[name], name).toBe(value);
    }
  });

  it('10. keeps existing Groq/RabbitMQ passthrough intact', () => {
    const overlay = gatewayEnv({ GROQ_API_KEY: 'k', RABBITMQ_URL: 'amqp://x' });
    expect(overlay['GROQ_API_KEY']).toBe('k');
    expect(overlay['RABBITMQ_URL']).toBe('amqp://x');
  });

  it('11. preserves unrelated services previous environment contracts', () => {
    const byName = new Map(DEV_SERVICES.map((s) => [s.name, s]));
    const registry = byName.get('registry');
    const orchestrator = byName.get('orchestrator');
    if (!registry || !orchestrator) {
      throw new Error('table incomplete');
    }
    const regEnv = buildChildEnv(registry, { env: { ...DB_ENV }, tokens: TOKENS });
    expect(regEnv['DATABASE_NAME']).toBe('oicunt_ai');
    expect(regEnv['PORT']).toBe('3001');
    const orchEnv = buildChildEnv(orchestrator, { env: { ...DB_ENV }, tokens: TOKENS });
    expect(orchEnv['DATABASE_HOST']).toBeUndefined();
    expect(orchEnv['MODEL_REGISTRY_BASE_URL']).toBe('http://127.0.0.1:3001');
  });

  it('12. never logs metering secret values', async () => {
    const canaryEnv = {
      ...DB_ENV,
      ...FAKE_OUTBOX_DB,
      OUTBOX_DB_PASSWORD: 'canary-outbox-password-xyz',
      ENABLE_USAGE_PUBLISHING: 'true',
    };
    const clock = fakeClock();
    const logs: string[] = [];
    const deps = {
      spawn: (_spec: ServiceSpec, _env: Record<string, string>) => mockChild(7100, true),
      checkPort: async (_port: number) => false,
      probe: async (_url: string) => 200,
      sleep: clock.sleep,
      log: (line: string) => {
        logs.push(line);
      },
      now: clock.now,
      timeouts: { health: 5000, ready: 10000 },
      intervalMs: 100,
    };
    const resolved = resolveTokenEnv(canaryEnv);
    if (!resolved.ok) {
      throw new Error('expected ok');
    }
    await startAll(deps, { env: canaryEnv, tokens: resolved.mapping });
    for (const line of logs) {
      expect(line).not.toContain('canary-outbox-password-xyz');
    }
  });
});

describe('probes and waits', () => {
  it('probeOnce maps status codes and transport failures', async () => {
    const okFetch = (async () => ({ status: 418 })) as unknown as typeof fetch;
    expect(await probeOnce('http://x', { fetchFn: okFetch })).toBe(418);
    const badFetch = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await probeOnce('http://x', { fetchFn: badFetch })).toBeNull();
  });

  it('waitFor resolves on first value and stays bounded on timeout', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await waitFor({
      check: async () => {
        calls += 1;
        return calls >= 3 ? 'done' : null;
      },
      sleep: clock.sleep,
      timeoutMs: 5000,
      intervalMs: 100,
      now: clock.now,
    });
    expect(result).toEqual({ ok: true, value: 'done' });
    expect(calls).toBe(3);

    const clock2 = fakeClock();
    let sleptTotal = 0;
    const timed = await waitFor({
      check: async () => null,
      sleep: async (ms: number) => {
        sleptTotal += ms;
        await clock2.sleep(ms);
      },
      timeoutMs: 5000,
      intervalMs: 1000,
      now: clock2.now,
    });
    expect(timed).toEqual({ ok: false, reason: 'timeout' });
    expect(sleptTotal).toBeLessThanOrEqual(6000);
  });

  it('waitFor reports early process exit', async () => {
    const clock = fakeClock();
    const result = await waitFor({
      check: async () => null,
      sleep: clock.sleep,
      timeoutMs: 5000,
      now: clock.now,
      isAlive: () => false,
    });
    expect(result).toEqual({ ok: false, reason: 'exited' });
  });

  it('checkTcpOpen distinguishes open from closed loopback ports', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) {
      throw new Error('no address');
    }
    expect(await checkTcpOpen('127.0.0.1', address.port, 1000)).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await checkTcpOpen('127.0.0.1', address.port, 500)).toBe(false);
  });

  it('prefixLines splits, prefixes, and carries partials', () => {
    const first = prefixLines('registry', 'a\nb\r\npartial');
    expect(first.lines).toEqual(['[registry] a', '[registry] b']);
    const second = prefixLines('registry', '-done\n', first.carry);
    expect(second.lines).toEqual(['[registry] partial-done']);
    expect(second.carry).toBe('');
  });
});

describe('startup orchestration', () => {
  function harness(
    options: {
      services?: ServiceSpec[];
      probeScript?: Array<number | null>;
      checkPort?: boolean;
      spawnImpl?: (spec: ServiceSpec) => MockChild;
    } = {},
  ) {
    const clock = fakeClock();
    const spawns: Array<{ spec: ServiceSpec; env: Record<string, string> }> = [];
    const logs: string[] = [];
    const children = new Map<string, MockChild>();
    let nextPid = 5000;
    const deps = {
      spawn: (spec: ServiceSpec, env: Record<string, string>) => {
        spawns.push({ spec, env });
        const child = options.spawnImpl ? options.spawnImpl(spec) : mockChild((nextPid += 1), true);
        children.set(spec.name, child);
        return child;
      },
      checkPort: async (_port: number) => options.checkPort ?? false,
      probe: scriptedProbe(options.probeScript ?? [200]).probe,
      sleep: clock.sleep,
      log: (line: string) => {
        logs.push(line);
      },
      now: clock.now,
      services: options.services,
      timeouts: { health: 5000, ready: 10000 },
      intervalMs: 100,
    };
    const ctx = { env: { ...DB_ENV }, tokens: TOKENS };
    return { deps, spawns, logs, children, ctx };
  }

  it('starts services in table order with gated probes', async () => {
    const h = harness({ probeScript: [503, 200, 503, 200] });
    const started: StartedService[] = await startAll(h.deps, h.ctx);
    expect(h.spawns.map((s) => s.spec.name)).toEqual([
      'registry',
      'model-gateway',
      'memory',
      'inference',
      'orchestrator',
    ]);
    expect(started).toHaveLength(5);
  });

  it('refuses duplicate ports without spawning', async () => {
    const h = harness({ checkPort: true, probeScript: [200] });
    await expect(startAll(h.deps, h.ctx)).rejects.toThrow(/port 3001.*already occupied/);
    expect(h.spawns).toHaveLength(0);
  });

  it('cleans up started children when a later service times out', async () => {
    const h = harness({});
    let calls = 0;
    const flaky = {
      ...h.deps,
      probe: async (_url: string) => {
        calls += 1;
        return calls <= 2 ? 200 : null;
      },
    };
    await expect(startAll(flaky, h.ctx)).rejects.toThrow(/never became healthy/);
    const first = h.children.get('registry');
    if (!first) {
      throw new Error('expected registry child');
    }
    expect(first.killed).toContain('SIGTERM');
    expect(h.spawns.map((s) => s.spec.name)).toEqual(['registry', 'model-gateway']);
  });

  it('treats early child exit as startup failure', async () => {
    const h = harness({
      spawnImpl: () => {
        const child = mockChild(6000, true);
        child.die(1);
        return child;
      },
    });
    await expect(startAll(h.deps, h.ctx)).rejects.toThrow(/exited during startup/);
  });

  it('never logs secret values', async () => {
    const canaryEnv = {
      ...DB_ENV,
      INTERNAL_SERVICE_TOKEN: 'canary-secret-token-xyz',
      DATABASE_PASSWORD: 'canary-db-password-xyz',
    };
    const clock = fakeClock();
    const logs: string[] = [];
    const deps = {
      spawn: (_spec: ServiceSpec, _env: Record<string, string>) => mockChild(7000, true),
      checkPort: async (_port: number) => false,
      probe: async (_url: string) => 200,
      sleep: clock.sleep,
      log: (line: string) => {
        logs.push(line);
      },
      now: clock.now,
      timeouts: { health: 5000, ready: 10000 },
      intervalMs: 100,
    };
    const resolved = resolveTokenEnv(canaryEnv);
    if (!resolved.ok) {
      throw new Error('expected ok');
    }
    await startAll(deps, { env: canaryEnv, tokens: resolved.mapping });
    for (const line of logs) {
      expect(line).not.toContain('canary-secret-token-xyz');
      expect(line).not.toContain('canary-db-password-xyz');
    }
  });
});

describe('shutdown', () => {
  function makers(names: string[]) {
    return names.map((name, index) => ({
      spec: { name, packageDir: `services/${name}`, entry: 'dist/start.js', port: 3000 + index },
      child: mockChild(8000 + index, true),
    }));
  }

  it('stops in reverse dependency order without force when graceful', async () => {
    const clock = fakeClock();
    const logs: string[] = [];
    const records = makers(['a', 'b', 'c']);
    await shutdownAll(records, {
      sleep: clock.sleep,
      log: (line: string) => {
        logs.push(line);
      },
      now: clock.now,
      graceMs: 5000,
    });
    for (const record of records) {
      expect(record.child.killed).toEqual(['SIGTERM']);
    }
    expect(
      logs
        .filter((l) => l.endsWith('stopped'))
        .map((l) => l.slice('[dev-up] '.length, -' stopped'.length)),
    ).toEqual(['c', 'b', 'a']);
    expect(logs.join('\n')).not.toContain('SIGKILL');
  });

  it('force-kills and reports stragglers after the grace period', async () => {
    const clock = fakeClock();
    const logs: string[] = [];
    const stuck = mockChild(9000, false);
    await shutdownAll(
      [{ spec: { name: 'stuck', packageDir: 's', entry: 'e', port: 1 }, child: stuck }],
      {
        sleep: clock.sleep,
        log: (line: string) => logs.push(line),
        now: clock.now,
        graceMs: 1000,
      },
    );
    expect(stuck.killed).toEqual(['SIGTERM', 'SIGKILL']);
    expect(logs.join('\n')).toContain('did not stop, sent SIGKILL');
  });

  it('shutdownOrder reverses without mutating', () => {
    const input = [{ name: 'a' }, { name: 'b' }];
    expect(shutdownOrder(input)).toEqual([{ name: 'b' }, { name: 'a' }]);
    expect(input).toEqual([{ name: 'a' }, { name: 'b' }]);
  });

  it('watchChildren reports unexpected death and detaches cleanly', () => {
    const child = mockChild(9100, true);
    const seen: Array<{ name: string; code: unknown }> = [];
    const detach = watchChildren(
      [{ spec: { name: 'svc', packageDir: 's', entry: 'e', port: 1 }, child }],
      (spec, code) => {
        seen.push({ name: spec.name, code });
      },
    );
    child.emitExit(3);
    expect(seen).toEqual([{ name: 'svc', code: 3 }]);
    detach();
    child.emitExit(4);
    expect(seen).toEqual([{ name: 'svc', code: 3 }]);
  });

  it('formatPortConflict names the port, service, and health', () => {
    const text = formatPortConflict(
      { name: 'registry', packageDir: 's', entry: 'e', port: 3001 },
      200,
    );
    expect(text).toContain('3001');
    expect(text).toContain('registry');
    expect(text).toContain('200');
    expect(formatPortConflict({ name: 'x', packageDir: 's', entry: 'e', port: 1 }, null)).toContain(
      'not responding',
    );
  });
});
