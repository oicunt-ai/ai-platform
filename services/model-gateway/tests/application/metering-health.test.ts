/**
 * Regression tests for metering readiness evaluation.
 *
 * The policy is pure and unit-testable: inference availability is
 * independent of the broker while durable capture is functional, and only
 * a dead capture store fails readiness closed.
 */
import { describe, expect, it } from 'vitest';
import { evaluateMeteringHealth } from '../../src/application/metering-health.js';

describe('evaluateMeteringHealth', () => {
  it('passes everything through when metering is disabled', () => {
    expect(
      evaluateMeteringHealth({
        inferenceReady: true,
        meteringEnabled: false,
        captureHealthy: false,
        publisherReady: false,
        backlog: { pending: 999, oldestPendingAgeSec: 9999, failed: 5 },
      }),
    ).toEqual({
      ready: true,
      checks: { capture: 'ok', publisher: 'ok', backlog: 'ok' },
    });
    expect(
      evaluateMeteringHealth({
        inferenceReady: false,
        meteringEnabled: false,
        captureHealthy: true,
        publisherReady: true,
        backlog: { pending: 0, oldestPendingAgeSec: null, failed: 0 },
      }).ready,
    ).toBe(false);
  });

  it('reports ready when capture is healthy even if the broker is down', () => {
    const health = evaluateMeteringHealth({
      inferenceReady: true,
      meteringEnabled: true,
      captureHealthy: true,
      publisherReady: false,
      backlog: { pending: 12, oldestPendingAgeSec: 60, failed: 0 },
    });
    expect(health.ready).toBe(true);
    expect(health.checks).toEqual({ capture: 'ok', publisher: 'failed', backlog: 'ok' });
  });

  it('fails closed when the durable capture store is unavailable', () => {
    const health = evaluateMeteringHealth({
      inferenceReady: true,
      meteringEnabled: true,
      captureHealthy: false,
      publisherReady: true,
      backlog: { pending: 0, oldestPendingAgeSec: null, failed: 0 },
    });
    expect(health.ready).toBe(false);
    expect(health.checks.capture).toBe('failed');
  });

  it('fails readiness when inference itself is down, regardless of metering', () => {
    const health = evaluateMeteringHealth({
      inferenceReady: false,
      meteringEnabled: true,
      captureHealthy: true,
      publisherReady: true,
      backlog: { pending: 0, oldestPendingAgeSec: null, failed: 0 },
    });
    expect(health.ready).toBe(false);
  });

  it('degrades the backlog check on quarantined rows', () => {
    const health = evaluateMeteringHealth({
      inferenceReady: true,
      meteringEnabled: true,
      captureHealthy: true,
      publisherReady: true,
      backlog: { pending: 0, oldestPendingAgeSec: null, failed: 2 },
    });
    // Informational only: inference stays ready while quarantine is visible.
    expect(health.ready).toBe(true);
    expect(health.checks.backlog).toBe('failed');
  });

  it('degrades the backlog check on excessive pending depth or age', () => {
    const deep = evaluateMeteringHealth({
      inferenceReady: true,
      meteringEnabled: true,
      captureHealthy: true,
      publisherReady: true,
      backlog: { pending: 1001, oldestPendingAgeSec: 10, failed: 0 },
    });
    expect(deep.ready).toBe(true);
    expect(deep.checks.backlog).toBe('failed');

    const stale = evaluateMeteringHealth({
      inferenceReady: true,
      meteringEnabled: true,
      captureHealthy: true,
      publisherReady: true,
      backlog: { pending: 3, oldestPendingAgeSec: 901, failed: 0 },
    });
    expect(stale.ready).toBe(true);
    expect(stale.checks.backlog).toBe('failed');
  });

  it('reports all-ok when every signal is healthy', () => {
    expect(
      evaluateMeteringHealth({
        inferenceReady: true,
        meteringEnabled: true,
        captureHealthy: true,
        publisherReady: true,
        backlog: { pending: 0, oldestPendingAgeSec: null, failed: 0 },
      }),
    ).toEqual({
      ready: true,
      checks: { capture: 'ok', publisher: 'ok', backlog: 'ok' },
    });
  });
});
