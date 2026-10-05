import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/domain/circuit-breaker.js';

describe('CircuitBreaker Domain Logic', () => {
  it('initializes in CLOSED state with 0% failure rate', () => {
    const cb = new CircuitBreaker('target-1', {
      failureThresholdPercentage: 50,
      slidingWindowSize: 10,
      cooldownPeriodMs: 1000,
    });

    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);

    const snapshot = cb.getSnapshot();
    expect(snapshot.state).toBe('CLOSED');
    expect(snapshot.failureRatePercentage).toBe(0);
    expect(snapshot.failureCount).toBe(0);
  });

  it('remains CLOSED when failures are below threshold', () => {
    const cb = new CircuitBreaker('target-1', {
      failureThresholdPercentage: 50,
      slidingWindowSize: 10,
      cooldownPeriodMs: 1000,
    });

    // 4 successes, 2 failures
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();

    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
    expect(cb.getSnapshot().failureCount).toBe(2);
  });

  it('transitions to OPEN when failure rate meets or exceeds threshold with at least 5 samples', () => {
    const cb = new CircuitBreaker('target-1', {
      failureThresholdPercentage: 50,
      slidingWindowSize: 10,
      cooldownPeriodMs: 5000,
    });

    // 2 successes, 3 failures (total 5 samples, 60% failure rate)
    cb.recordSuccess();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);
  });

  it('does not open prematurely if fewer than minimum samples (5) exist', () => {
    const cb = new CircuitBreaker('target-1', {
      failureThresholdPercentage: 50,
      slidingWindowSize: 10,
      cooldownPeriodMs: 5000,
    });

    // 4 failures out of 4 (100% failure rate, but only 4 samples)
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);

    // 5th failure pushes it over the 5 sample minimum
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions to HALF_OPEN after cooldown period expires and probes execution', async () => {
    const cb = new CircuitBreaker('target-1', {
      failureThresholdPercentage: 50,
      slidingWindowSize: 5,
      cooldownPeriodMs: 50, // 50ms cooldown for fast test
    });

    for (let i = 0; i < 5; i++) {
      cb.recordFailure();
    }
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 60));

    // canExecute should now transition to HALF_OPEN and return true
    expect(cb.canExecute()).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');
  });

  it('re-opens immediately if probe fails in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker('target-1', {
      failureThresholdPercentage: 50,
      slidingWindowSize: 5,
      cooldownPeriodMs: 40,
    });

    for (let i = 0; i < 5; i++) {
      cb.recordFailure();
    }
    expect(cb.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cb.canExecute()).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');

    // Probe fails
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);
  });

  it('closes and resets window if probe succeeds in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker('target-1', {
      failureThresholdPercentage: 50,
      slidingWindowSize: 5,
      cooldownPeriodMs: 40,
    });

    for (let i = 0; i < 5; i++) {
      cb.recordFailure();
    }
    expect(cb.getState()).toBe('OPEN');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cb.canExecute()).toBe(true);
    expect(cb.getState()).toBe('HALF_OPEN');

    // Probe succeeds
    cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
    expect(cb.getSnapshot().failureCount).toBe(0);
  });

  it('manually resets circuit breaker', () => {
    const cb = new CircuitBreaker('target-1');
    for (let i = 0; i < 5; i++) {
      cb.recordFailure();
    }
    expect(cb.getState()).toBe('OPEN');

    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
    expect(cb.getSnapshot().failureCount).toBe(0);
  });
});
