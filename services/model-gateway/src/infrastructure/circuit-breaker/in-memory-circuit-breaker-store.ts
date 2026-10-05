import { CircuitBreaker } from '../../domain/circuit-breaker.js';
import type { CircuitBreakerConfig, TargetHealthSnapshot } from '../../domain/types.js';
import type { CircuitBreakerStorePort } from '../../application/ports/circuit-breaker-store.port.js';

export class InMemoryCircuitBreakerStore implements CircuitBreakerStorePort {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly defaultConfig?: Partial<CircuitBreakerConfig> | undefined;

  constructor(defaultConfig?: Partial<CircuitBreakerConfig>) {
    this.defaultConfig = defaultConfig;
  }

  public getBreaker(targetId: string): CircuitBreaker {
    let breaker = this.breakers.get(targetId);
    if (!breaker) {
      breaker = new CircuitBreaker(targetId, this.defaultConfig);
      this.breakers.set(targetId, breaker);
    }
    return breaker;
  }

  public getAllSnapshots(): TargetHealthSnapshot[] {
    return Array.from(this.breakers.values()).map((b) => b.getSnapshot());
  }

  public resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}
