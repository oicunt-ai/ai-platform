import { describe, expect, it } from 'vitest';
import { ExecutionBudget } from '../../src/domain/execution-budget.js';
import { InferenceTimeoutError } from '../../src/domain/errors.js';

describe('ExecutionBudget Domain Logic', () => {
  it('enforces total execution attempt ceiling', () => {
    const budget = new ExecutionBudget({
      deadlineMs: Date.now() + 60000,
      maxAttemptsPerTarget: 3,
      maxFallbackAttempts: 2,
      maxTotalExecutionAttempts: 3,
    });

    expect(budget.canAttemptTarget('target-a')).toBe(true);
    budget.recordAttempt('target-a');
    expect(budget.getTotalAttempts()).toBe(1);

    budget.recordAttempt('target-a');
    expect(budget.getTotalAttempts()).toBe(2);

    budget.recordAttempt('target-a');
    expect(budget.getTotalAttempts()).toBe(3);

    // Total attempts reached ceiling
    expect(budget.isTotalAttemptsExhausted()).toBe(true);
    expect(budget.canAttemptTarget('target-a')).toBe(false);
    expect(budget.canAttemptTarget('target-b')).toBe(false);
  });

  it('enforces per-target attempt limit', () => {
    const budget = new ExecutionBudget({
      deadlineMs: Date.now() + 60000,
      maxAttemptsPerTarget: 2,
      maxFallbackAttempts: 2,
      maxTotalExecutionAttempts: 4,
    });

    expect(budget.canAttemptTarget('target-a')).toBe(true);
    budget.recordAttempt('target-a');
    budget.recordAttempt('target-a');

    // Target A has reached its limit
    expect(budget.canAttemptTarget('target-a')).toBe(false);
    // Target B has not reached its limit
    expect(budget.canAttemptTarget('target-b')).toBe(true);
  });

  it('enforces fallback attempt limit', () => {
    const budget = new ExecutionBudget({
      deadlineMs: Date.now() + 60000,
      maxAttemptsPerTarget: 2,
      maxFallbackAttempts: 1, // Only 1 fallback allowed
      maxTotalExecutionAttempts: 4,
    });

    // Initial target
    expect(budget.canAttemptTarget('target-1')).toBe(true);
    budget.recordAttempt('target-1');

    // First fallback
    expect(budget.canAttemptTarget('target-2')).toBe(true);
    budget.recordAttempt('target-2');

    // Second fallback is blocked because maxFallbackAttempts is 1
    expect(budget.canAttemptTarget('target-3')).toBe(false);
  });

  it('disallows attempts when deadline has expired', async () => {
    const budget = new ExecutionBudget({
      deadlineMs: Date.now() + 50, // very short timeout
      minConnectionBudgetMs: 10,
      maxAttemptsPerTarget: 3,
      maxFallbackAttempts: 2,
      maxTotalExecutionAttempts: 4,
    });

    // Wait until deadline has passed
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(budget.isDeadlineExceeded()).toBe(true);
    expect(budget.canAttemptTarget('target-a')).toBe(false);
  });

  it('throws InferenceTimeoutError when asserting remaining budget after deadline', async () => {
    const budget = new ExecutionBudget({
      deadlineMs: Date.now() + 20,
      minConnectionBudgetMs: 10,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(() => budget.assertCanAttempt('target-a', 'claude-sonnet', 'test-corr-5')).toThrow(
      InferenceTimeoutError,
    );
  });

  it('creates an attempt signal bounded by attempt timeout and global budget', () => {
    const budget = new ExecutionBudget({
      deadlineMs: Date.now() + 10000,
    });

    const { signal, cleanup, attemptTimeoutMs } = budget.createAttemptSignal(2000);
    expect(attemptTimeoutMs).toBe(2000);
    expect(signal.aborted).toBe(false);
    cleanup();
  });

  it('aborts attempt signal if upstream caller signal aborts', () => {
    const upstreamController = new AbortController();
    const budget = new ExecutionBudget({
      deadlineMs: Date.now() + 10000,
      parentSignal: upstreamController.signal,
    });

    const { signal, cleanup } = budget.createAttemptSignal();
    expect(signal.aborted).toBe(false);

    upstreamController.abort(new Error('User cancelled'));
    expect(signal.aborted).toBe(true);
    cleanup();
  });
});
