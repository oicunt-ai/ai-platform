import type { CircuitBreakerConfig, CircuitBreakerState, TargetHealthSnapshot } from './types.js';

export class CircuitBreaker {
  public readonly targetId: string;
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState = 'CLOSED';
  private lastStateChange: Date = new Date();
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;

  // Sliding window of boolean outcomes: true = success, false = failure
  private outcomes: boolean[] = [];

  constructor(targetId: string, config?: Partial<CircuitBreakerConfig>) {
    this.targetId = targetId;
    this.config = {
      failureThresholdPercentage: config?.failureThresholdPercentage ?? 50,
      slidingWindowSize: config?.slidingWindowSize ?? 20,
      cooldownPeriodMs: config?.cooldownPeriodMs ?? 30000,
    };
  }

  public getState(): CircuitBreakerState {
    this.evaluateState();
    return this.state;
  }

  public canExecute(): boolean {
    this.evaluateState();

    switch (this.state) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        return false;
      case 'HALF_OPEN':
        if (!this.halfOpenProbeInFlight) {
          this.halfOpenProbeInFlight = true;
          return true;
        }
        return false;
    }
  }

  public recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED');
      this.halfOpenProbeInFlight = false;
      this.outcomes = [];
      this.openedAt = null;
      return;
    }

    if (this.state === 'CLOSED') {
      this.appendOutcome(true);
    }
  }

  public recordFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.transitionTo('OPEN');
      this.halfOpenProbeInFlight = false;
      this.openedAt = Date.now();
      return;
    }

    if (this.state === 'CLOSED') {
      this.appendOutcome(false);
      this.evaluateFailureThreshold();
    }
  }

  public reset(): void {
    this.transitionTo('CLOSED');
    this.outcomes = [];
    this.openedAt = null;
    this.halfOpenProbeInFlight = false;
  }

  public getSnapshot(): TargetHealthSnapshot {
    this.evaluateState();
    const total = this.outcomes.length;
    const failures = this.outcomes.filter((o) => !o).length;
    const rate = total > 0 ? (failures / total) * 100 : 0;

    let cooldownRemaining = 0;
    if (this.state === 'OPEN' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      cooldownRemaining = Math.max(0, this.config.cooldownPeriodMs - elapsed);
    }

    return {
      targetId: this.targetId,
      state: this.state,
      failureCount: failures,
      totalRequests: total,
      failureRatePercentage: rate,
      lastStateChange: this.lastStateChange,
      cooldownRemainingMs: cooldownRemaining,
    };
  }

  private evaluateState(): void {
    if (this.state === 'OPEN' && this.openedAt !== null) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.config.cooldownPeriodMs) {
        this.transitionTo('HALF_OPEN');
        this.halfOpenProbeInFlight = false;
      }
    }
  }

  private evaluateFailureThreshold(): void {
    if (this.outcomes.length >= Math.min(5, this.config.slidingWindowSize)) {
      const failures = this.outcomes.filter((o) => !o).length;
      const rate = (failures / this.outcomes.length) * 100;
      if (rate >= this.config.failureThresholdPercentage) {
        this.openedAt = Date.now();
        this.transitionTo('OPEN');
      }
    }
  }

  private appendOutcome(success: boolean): void {
    this.outcomes.push(success);
    if (this.outcomes.length > this.config.slidingWindowSize) {
      this.outcomes.shift();
    }
  }

  private transitionTo(newState: CircuitBreakerState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.lastStateChange = new Date();
    }
  }
}
