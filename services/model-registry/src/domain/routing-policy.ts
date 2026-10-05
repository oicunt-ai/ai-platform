import { randomUUID } from 'node:crypto';
import type { CanonicalModelId } from '@oicunt-ai/model-types';
import type { DegradationBehavior, RoutingPolicyData, RoutingStrategy } from './types.js';
import { InvalidRoutingPolicyError } from './errors.js';

export interface CreateRoutingPolicyParams {
  readonly id?: string | undefined;
  readonly canonicalModelId: CanonicalModelId;
  readonly strategy?: RoutingStrategy | undefined;
  readonly maxFallbackAttempts?: number | undefined;
  readonly requireHealthyTarget?: boolean | undefined;
  readonly degradationBehavior?: DegradationBehavior | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

const VALID_STRATEGIES: readonly RoutingStrategy[] = [
  'priority-fallback',
  'weighted-round-robin',
  'lowest-latency',
];

const VALID_DEGRADATIONS: readonly DegradationBehavior[] = [
  'fail-fast',
  'fallback-to-fast',
  'queue',
];

export class RoutingPolicy {
  public readonly id: string;
  public readonly canonicalModelId: CanonicalModelId;
  public readonly strategy: RoutingStrategy;
  public readonly maxFallbackAttempts: number;
  public readonly requireHealthyTarget: boolean;
  public readonly degradationBehavior: DegradationBehavior;
  public readonly createdAt: string;
  public readonly updatedAt: string;

  constructor(params: CreateRoutingPolicyParams) {
    const strategy = params.strategy ?? 'priority-fallback';
    const degradationBehavior = params.degradationBehavior ?? 'fail-fast';
    const maxFallbackAttempts = params.maxFallbackAttempts ?? 2;

    this.validateStrategy(strategy);
    this.validateDegradationBehavior(degradationBehavior);
    this.validateMaxFallbackAttempts(maxFallbackAttempts);

    this.id = params.id ?? randomUUID();
    this.canonicalModelId = params.canonicalModelId;
    this.strategy = strategy;
    this.maxFallbackAttempts = maxFallbackAttempts;
    this.requireHealthyTarget = params.requireHealthyTarget ?? true;
    this.degradationBehavior = degradationBehavior;
    this.createdAt = params.createdAt ?? new Date().toISOString();
    this.updatedAt = params.updatedAt ?? this.createdAt;
  }

  public toJSON(): RoutingPolicyData {
    return {
      id: this.id,
      canonicalModelId: this.canonicalModelId,
      strategy: this.strategy,
      maxFallbackAttempts: this.maxFallbackAttempts,
      requireHealthyTarget: this.requireHealthyTarget,
      degradationBehavior: this.degradationBehavior,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private validateStrategy(strategy: RoutingStrategy): void {
    if (!VALID_STRATEGIES.includes(strategy)) {
      throw new InvalidRoutingPolicyError(
        `Invalid routing strategy '${strategy}'. Supported: ${VALID_STRATEGIES.join(', ')}`,
      );
    }
  }

  private validateDegradationBehavior(behavior: DegradationBehavior): void {
    if (!VALID_DEGRADATIONS.includes(behavior)) {
      throw new InvalidRoutingPolicyError(
        `Invalid degradation behavior '${behavior}'. Supported: ${VALID_DEGRADATIONS.join(', ')}`,
      );
    }
  }

  private validateMaxFallbackAttempts(attempts: number): void {
    if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) {
      throw new InvalidRoutingPolicyError(
        'maxFallbackAttempts must be a non-negative integer >= 0',
      );
    }
  }
}
