import type { CircuitBreaker } from '../../domain/circuit-breaker.js';
import type { TargetHealthSnapshot } from '../../domain/types.js';

export interface CircuitBreakerStorePort {
  getBreaker(targetId: string): CircuitBreaker;
  getAllSnapshots(): TargetHealthSnapshot[];
  resetAll(): void;
}
