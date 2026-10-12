import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Pinned Platform revision for the authenticated multi-hop integration
 * test. MUST match the `ref:` of the "Checkout Platform dependency" step
 * in .github/workflows/ci.yml — update both together. The test verifies
 * the provided checkout against this SHA (enforced in CI, warning
 * locally) so results are reproducible.
 */
export const PLATFORM_GATEWAY_PINNED_SHA = 'e000278e9c4d79ad15c4e418413fac61a01e285f';

export interface PlatformDistResolution {
  /** Candidate checkout roots, in order. Defaults to env override + sibling layout. */
  readonly repoRoots?: readonly string[] | undefined;
  /** Revision reader. Defaults to `git rev-parse HEAD` in the root. */
  readonly readRevision?: ((root: string) => string | null) | undefined;
  /** CI flag value. Defaults to process.env.CI. */
  readonly ci?: string | undefined;
  /** Warning sink. Defaults to console.warn. */
  readonly warn?: ((message: string) => void) | undefined;
}

function defaultRoots(): string[] {
  const roots: string[] = [];
  const fromEnv = process.env['PLATFORM_REPO_ROOT'];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    roots.push(fromEnv);
  }
  // Existing local sibling-repository development layout.
  roots.push(resolve(process.cwd(), '../platform'));
  return roots;
}

function defaultReadRevision(root: string): string | null {
  try {
    const head = execSync('git rev-parse HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return /^[0-9a-f]{40}$/.test(head) ? head : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the built Platform Gateway distribution for dynamic import.
 * Never returns silently: a missing checkout or an unexpected revision
 * throws an actionable error naming the exact paths and remedies. Does
 * not weaken or skip the integration test — callers must let this throw.
 */
export function resolvePlatformGatewayDist(overrides?: PlatformDistResolution): string {
  const roots = overrides?.repoRoots ?? defaultRoots();
  const readRevision = overrides?.readRevision ?? defaultReadRevision;
  const ci = overrides?.ci ?? process.env['CI'];
  const warn = overrides?.warn ?? ((message: string) => console.warn(message));
  const attempted: string[] = [];
  for (const root of roots) {
    const distPath = join(root, 'services', 'api-gateway', 'dist', 'index.js');
    if (!existsSync(distPath)) {
      attempted.push(distPath);
      continue;
    }
    const actual = readRevision(root);
    if (actual !== null && actual !== PLATFORM_GATEWAY_PINNED_SHA) {
      const message =
        `Platform checkout at ${root} is at ${actual}, expected pinned revision ` +
        `${PLATFORM_GATEWAY_PINNED_SHA} (see .github/workflows/ci.yml). ` +
        `Update the checkout or the pin together.`;
      if (ci === 'true') {
        throw new Error(message);
      }
      warn(`[platform-gateway-dist] ${message} Proceeding with local revision.`);
    }
    return pathToFileURL(distPath).href;
  }
  throw new Error(
    'Platform Gateway distribution not found. Provide a Platform checkout of the pinned ' +
      `revision ${PLATFORM_GATEWAY_PINNED_SHA} at ../platform (local sibling layout) or set ` +
      'PLATFORM_REPO_ROOT to its root, then build the api-gateway package ' +
      '(`pnpm --filter @oicunt/service-api-gateway build` from the Platform root). ' +
      `Attempted: ${attempted.join(', ') || '(no candidate roots)'}.`,
  );
}
