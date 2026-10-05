export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  readonly failureThresholdPercentage: number;
  readonly slidingWindowSize: number;
  readonly cooldownPeriodMs: number;
}

export interface RetryPolicyConfig {
  readonly maxAttemptsPerTarget: number;
  readonly maxFallbackAttempts: number;
  readonly maxTotalExecutionAttempts: number;
  readonly initialBackoffDelayMs: number;
  readonly maxBackoffDelayMs: number;
  readonly backoffMultiplier: number;
}

export interface TargetHealthSnapshot {
  readonly targetId: string;
  readonly state: CircuitBreakerState;
  readonly failureCount: number;
  readonly totalRequests: number;
  readonly failureRatePercentage: number;
  readonly lastStateChange: Date;
  readonly cooldownRemainingMs: number;
}

export interface AttemptRecord {
  readonly attemptNumber: number;
  readonly targetId: string;
  readonly provider: string;
  readonly startedAt: Date;
  readonly finishedAt?: Date | undefined;
  readonly success: boolean;
  readonly error?: string | undefined;
}
