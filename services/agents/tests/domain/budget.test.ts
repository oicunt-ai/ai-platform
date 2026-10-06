import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXECUTION_BUDGET,
  HARD_LIMITS,
  resolveExecutionBudget,
} from '../../src/domain/value-objects.js';

describe('ExecutionBudget Domain Logic', () => {
  it('resolves default execution budget when no overrides provided', () => {
    const budget = resolveExecutionBudget(undefined, DEFAULT_EXECUTION_BUDGET);

    expect(budget.maxSteps).toBe(15);
    expect(budget.maxModelCalls).toBe(20);
    expect(budget.maxToolCalls).toBe(30);
    expect(budget.maxConsecutiveErrors).toBe(3);
    expect(budget.deadlineMs).toBeGreaterThan(Date.now() + 60_000);
  });

  it('respects caller overrides within bounds', () => {
    const budget = resolveExecutionBudget(
      {
        maxSteps: 8,
        maxModelCalls: 10,
        maxToolCalls: 12,
        maxConsecutiveErrors: 2,
        maxTokens: 10_000,
      },
      DEFAULT_EXECUTION_BUDGET,
      30_000,
    );

    expect(budget.maxSteps).toBe(8);
    expect(budget.maxModelCalls).toBe(10);
    expect(budget.maxToolCalls).toBe(12);
    expect(budget.maxConsecutiveErrors).toBe(2);
    expect(budget.maxTokens).toBe(10_000);
    expect(budget.deadlineMs).toBeLessThanOrEqual(Date.now() + 30_000);
  });

  it('enforces hard platform ceilings', () => {
    const budget = resolveExecutionBudget(
      {
        maxSteps: 999,
        maxModelCalls: 500,
        maxToolCalls: 500,
      },
      DEFAULT_EXECUTION_BUDGET,
    );

    expect(budget.maxSteps).toBe(HARD_LIMITS.MAX_STEPS);
    expect(budget.maxModelCalls).toBe(HARD_LIMITS.MAX_MODEL_CALLS);
    expect(budget.maxToolCalls).toBe(HARD_LIMITS.MAX_TOOL_CALLS);
  });

  it('preserves caller deadlineMs if monotonic and valid', () => {
    const targetDeadline = Date.now() + 45_000;
    const budget = resolveExecutionBudget(
      {
        deadlineMs: targetDeadline,
      },
      DEFAULT_EXECUTION_BUDGET,
    );

    expect(budget.deadlineMs).toBe(targetDeadline);
  });
});
