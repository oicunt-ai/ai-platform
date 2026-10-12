import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLATFORM_GATEWAY_PINNED_SHA,
  resolvePlatformGatewayDist,
} from './platform-gateway-dist.js';

const OTHER_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeDistRoot(): string {
  const root = join(
    tmpdir(),
    `oicunt-platform-dep-${process.pid}-${Math.floor(Math.random() * 1e9)}`,
  );
  const distDir = join(root, 'services', 'api-gateway', 'dist');
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.js'), 'export const marker = true;\n');
  return root;
}

describe('resolvePlatformGatewayDist', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws an actionable error when no distribution exists anywhere', () => {
    expect(() =>
      resolvePlatformGatewayDist({
        repoRoots: [join(tmpdir(), 'oicunt-platform-dep-definitely-absent')],
        readRevision: () => OTHER_SHA,
      }),
    ).toThrow(/Platform Gateway distribution not found/);
    try {
      resolvePlatformGatewayDist({
        repoRoots: [join(tmpdir(), 'oicunt-platform-dep-definitely-absent')],
      });
      expect.unreachable('must throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PLATFORM_REPO_ROOT');
      expect(message).toContain('pnpm --filter @oicunt/service-api-gateway build');
      expect(message).toContain(PLATFORM_GATEWAY_PINNED_SHA);
    }
  });

  it('resolves a provided checkout and enforces nothing when revisions match', () => {
    const root = makeDistRoot();
    const warnings: string[] = [];
    const href = resolvePlatformGatewayDist({
      repoRoots: [root],
      readRevision: () => PLATFORM_GATEWAY_PINNED_SHA,
      ci: 'true',
      warn: (message) => warnings.push(message),
    });
    expect(href).toContain('services/api-gateway/dist/index.js');
    expect(href.startsWith('file:')).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('rejects a mismatched revision loudly in CI', () => {
    const root = makeDistRoot();
    expect(() =>
      resolvePlatformGatewayDist({
        repoRoots: [root],
        readRevision: () => OTHER_SHA,
        ci: 'true',
      }),
    ).toThrow(/expected pinned revision/);
  });

  it('warns but proceeds on mismatch outside CI', () => {
    const root = makeDistRoot();
    const warnings: string[] = [];
    const href = resolvePlatformGatewayDist({
      repoRoots: [root],
      readRevision: () => OTHER_SHA,
      warn: (message) => warnings.push(message),
    });
    expect(href).toContain('services/api-gateway/dist/index.js');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('expected pinned revision');
  });

  it('keeps working through PLATFORM_REPO_ROOT in the real environment', () => {
    const root = makeDistRoot();
    vi.stubEnv('PLATFORM_REPO_ROOT', root);
    const href = resolvePlatformGatewayDist({ readRevision: () => PLATFORM_GATEWAY_PINNED_SHA });
    expect(href).toContain('services/api-gateway/dist/index.js');
  });

  it('pins a full-length commit SHA (value paired with ci.yml checkout ref)', () => {
    expect(PLATFORM_GATEWAY_PINNED_SHA).toMatch(/^[0-9a-f]{40}$/);
  });
});
