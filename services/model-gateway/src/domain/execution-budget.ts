import { InferenceTimeoutError } from './errors.js';

export interface ExecutionBudgetConfig {
  /** Authoritative overall deadline timestamp in Epoch MS */
  readonly deadlineMs: number;
  /** Maximum retry attempts per individual target */
  readonly maxAttemptsPerTarget?: number | undefined;
  /** Maximum fallback attempts to alternative targets */
  readonly maxFallbackAttempts?: number | undefined;
  /** Global execution attempts cap across all targets combined */
  readonly maxTotalExecutionAttempts?: number | undefined;
  /** Minimum remaining budget required to initiate a target attempt (default: 1000ms) */
  readonly minConnectionBudgetMs?: number | undefined;
  /** Optional caller cancellation signal */
  readonly parentSignal?: AbortSignal | undefined;
}

export class ExecutionBudget {
  public readonly deadlineMs: number;
  public readonly maxAttemptsPerTarget: number;
  public readonly maxFallbackAttempts: number;
  public readonly maxTotalExecutionAttempts: number;
  public readonly minConnectionBudgetMs: number;
  private readonly parentSignal?: AbortSignal | undefined;

  private totalAttempts = 0;
  private readonly targetAttempts = new Map<string, number>();
  private readonly targetedIds: string[] = [];

  constructor(config: ExecutionBudgetConfig) {
    this.deadlineMs = config.deadlineMs;
    this.maxAttemptsPerTarget = config.maxAttemptsPerTarget ?? 3;
    this.maxFallbackAttempts = config.maxFallbackAttempts ?? 2;
    this.maxTotalExecutionAttempts = config.maxTotalExecutionAttempts ?? 4;
    this.minConnectionBudgetMs = config.minConnectionBudgetMs ?? 1000;
    this.parentSignal = config.parentSignal;
  }

  public getRemainingBudgetMs(): number {
    const remaining = this.deadlineMs - Date.now();
    return Math.max(0, remaining);
  }

  public isDeadlineExceeded(): boolean {
    return this.getRemainingBudgetMs() < this.minConnectionBudgetMs;
  }

  public isTotalAttemptsExhausted(): boolean {
    return this.totalAttempts >= this.maxTotalExecutionAttempts;
  }

  public getAttemptsForTarget(targetId: string): number {
    return this.targetAttempts.get(targetId) ?? 0;
  }

  public getTotalAttempts(): number {
    return this.totalAttempts;
  }

  public canAttemptTarget(targetId: string): boolean {
    if (this.parentSignal?.aborted) {
      return false;
    }
    if (this.isDeadlineExceeded()) {
      return false;
    }
    if (this.isTotalAttemptsExhausted()) {
      return false;
    }

    const currentTargetAttempts = this.getAttemptsForTarget(targetId);
    if (currentTargetAttempts >= this.maxAttemptsPerTarget) {
      return false;
    }

    // Fallback limit check: if this is a new target, ensure fallback limit is not breached
    if (currentTargetAttempts === 0 && !this.targetedIds.includes(targetId)) {
      // First target is initial; subsequent targets are fallbacks
      const fallbackCount = this.targetedIds.length;
      if (fallbackCount > this.maxFallbackAttempts) {
        return false;
      }
    }

    return true;
  }

  public recordAttempt(targetId: string): void {
    if (!this.targetedIds.includes(targetId)) {
      this.targetedIds.push(targetId);
    }
    const current = this.getAttemptsForTarget(targetId);
    this.targetAttempts.set(targetId, current + 1);
    this.totalAttempts += 1;
  }

  public assertCanAttempt(targetId: string, canonicalModelId: string, correlationId: string): void {
    if (this.parentSignal?.aborted) {
      throw new Error('Operation aborted by caller');
    }
    if (this.isDeadlineExceeded()) {
      throw new InferenceTimeoutError(
        canonicalModelId,
        correlationId,
        targetId,
        `Overall request execution deadline exceeded. Remaining budget: ${this.getRemainingBudgetMs()}ms`,
      );
    }
  }

  /**
   * Creates an AbortSignal bounded by target max timeout, overall remaining deadline, and parent signal.
   */
  public createAttemptSignal(targetMaxTimeoutMs?: number): {
    signal: AbortSignal;
    cleanup: () => void;
    attemptTimeoutMs: number;
  } {
    const remaining = this.getRemainingBudgetMs();
    const effectiveTimeout =
      targetMaxTimeoutMs !== undefined ? Math.min(targetMaxTimeoutMs, remaining) : remaining;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error(`Attempt timed out after ${effectiveTimeout}ms`));
    }, effectiveTimeout);

    const onParentAbort = (): void => {
      clearTimeout(timeoutId);
      controller.abort(this.parentSignal?.reason ?? new Error('Parent request aborted'));
    };

    if (this.parentSignal) {
      if (this.parentSignal.aborted) {
        clearTimeout(timeoutId);
        controller.abort(this.parentSignal.reason);
      } else {
        this.parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }
    }

    const cleanup = (): void => {
      clearTimeout(timeoutId);
      if (this.parentSignal) {
        this.parentSignal.removeEventListener('abort', onParentAbort);
      }
    };

    return {
      signal: controller.signal,
      cleanup,
      attemptTimeoutMs: effectiveTimeout,
    };
  }
}
