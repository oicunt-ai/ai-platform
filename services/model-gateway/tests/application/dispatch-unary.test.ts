import { describe, expect, it } from 'vitest';
import type {
  GatewayDispatchPayload,
  ResolvedTargetDto,
} from '../../src/application/dtos/dispatch.dto.js';
import { DispatchModelUseCase } from '../../src/application/use-cases/dispatch-model.use-case.js';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  ModelUnavailableError,
  RateLimitExceededError,
  RequestCancelledError,
} from '../../src/domain/errors.js';
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { InMemoryCircuitBreakerStore } from '../../src/infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

describe('DispatchModelUseCase - Unary Execution', () => {
  function createFixture(targetOverrides: Partial<ResolvedTargetDto>[] = []) {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore({
      failureThresholdPercentage: 50,
      slidingWindowSize: 10,
      cooldownPeriodMs: 30000,
    });

    const fakeAdapterA = new FakeProviderAdapter('test-provider');
    const fakeAdapterB = new FakeProviderAdapter('openai');
    adapterRegistry.register(fakeAdapterA);
    adapterRegistry.register(fakeAdapterB);

    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
    });

    const defaultTargets: ResolvedTargetDto[] = [
      {
        targetId: 'target-primary',
        provider: 'test-provider',
        upstreamModelId: 'primary-model',
        priority: 1,
        weight: 100,
        supportsStreaming: true,
        ...targetOverrides[0],
      },
      {
        targetId: 'target-secondary',
        provider: 'openai',
        upstreamModelId: 'fallback-model',
        priority: 2,
        weight: 100,
        supportsStreaming: true,
        ...targetOverrides[1],
      },
    ];

    const basePayload: GatewayDispatchPayload = {
      requestId: 'req-1',
      correlationId: 'corr-1',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      version: '1.0.0',
      stream: false,
      messages: [{ role: 'user', content: 'Hello world' }],
      limits: {
        contextWindowTokens: 100000,
        maxOutputTokens: 4096,
      },
      pricing: {
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
      },
      eligibleTargets: defaultTargets,
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      actorId: 'test-actor',
    };

    return { useCase, fakeAdapterA, fakeAdapterB, basePayload, circuitBreakerStore };
  }

  it('dispatches to primary target based on priority ordering', async () => {
    const { useCase, fakeAdapterA, fakeAdapterB, basePayload } = createFixture();

    const result = await useCase.executeUnary(basePayload);

    expect(fakeAdapterA.unaryCalls).toHaveLength(1);
    expect(fakeAdapterB.unaryCalls).toHaveLength(0);
    expect(result.completionId).toBeDefined();
    expect(result.message.role).toBe('assistant');
  });

  it('retries within target when a retryable error occurs, then succeeds', async () => {
    const { useCase, fakeAdapterA, basePayload } = createFixture();

    // 1st call fails with 429 RateLimit, 2nd call succeeds
    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new RateLimitExceededError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });

    const result = await useCase.executeUnary(basePayload);

    expect(fakeAdapterA.unaryCalls).toHaveLength(2);
    expect(result.message.role).toBe('assistant');
  });

  it('falls back to secondary target when primary target retries are exhausted', async () => {
    const { useCase, fakeAdapterA, fakeAdapterB, basePayload } = createFixture();

    // Primary target fails all 3 attempts
    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });
    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });
    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });

    const result = await useCase.executeUnary(basePayload);

    expect(fakeAdapterA.unaryCalls).toHaveLength(3);
    expect(fakeAdapterB.unaryCalls).toHaveLength(1);
    expect(result.completionId).toBeDefined();
  });

  it('fails immediately without retrying on non-retryable ContextWindowExceededError', async () => {
    const { useCase, fakeAdapterA, fakeAdapterB, basePayload } = createFixture();

    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new ContextWindowExceededError('oicunt.model.catalog-alpha', 'corr-1', {
        exceededBy: 5000,
      });
    });

    await expect(useCase.executeUnary(basePayload)).rejects.toThrow(ContextWindowExceededError);

    // Should only have attempted once and not fallen back to B
    expect(fakeAdapterA.unaryCalls).toHaveLength(1);
    expect(fakeAdapterB.unaryCalls).toHaveLength(0);
  });

  it('skips target with OPEN circuit breaker and executes fallback directly', async () => {
    const { useCase, fakeAdapterA, fakeAdapterB, basePayload, circuitBreakerStore } =
      createFixture();

    // Pre-trip circuit breaker for primary target
    const breaker = circuitBreakerStore.getBreaker('target-primary');
    for (let i = 0; i < 5; i++) {
      breaker.recordFailure();
    }
    expect(breaker.getState()).toBe('OPEN');

    const result = await useCase.executeUnary(basePayload);

    expect(fakeAdapterA.unaryCalls).toHaveLength(0);
    expect(fakeAdapterB.unaryCalls).toHaveLength(1);
    expect(result.completionId).toBeDefined();
  });

  it('throws AllTargetsExhaustedError when all targets fail', async () => {
    const { useCase, fakeAdapterA, fakeAdapterB, basePayload } = createFixture();

    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });
    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });
    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });

    fakeAdapterB.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-secondary');
    });
    fakeAdapterB.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-secondary');
    });
    fakeAdapterB.enqueueUnaryResponse(async () => {
      throw new ModelUnavailableError('oicunt.model.catalog-alpha', 'corr-1', 'target-secondary');
    });

    await expect(useCase.executeUnary(basePayload)).rejects.toThrow(AllTargetsExhaustedError);
  });

  it('validates context limit against prompt token estimate before dispatch', async () => {
    const { useCase, basePayload } = createFixture();

    const payloadExceedingLimit: GatewayDispatchPayload = {
      ...basePayload,
      limits: {
        contextWindowTokens: 5, // very small limit
        maxOutputTokens: 10,
      },
      messages: [
        { role: 'user', content: 'This message is clearly way longer than 5 tokens limit' },
      ],
    };

    await expect(useCase.executeUnary(payloadExceedingLimit)).rejects.toThrow(
      ContextWindowExceededError,
    );
  });

  it('aborts unary execution immediately when parentSignal is cancelled before or during call', async () => {
    const { useCase, fakeAdapterA, basePayload } = createFixture();

    // Already cancelled signal
    const preAbortedController = new AbortController();
    preAbortedController.abort(new Error('Pre-aborted'));

    await expect(useCase.executeUnary(basePayload, preAbortedController.signal)).rejects.toThrow(
      RequestCancelledError,
    );
    expect(fakeAdapterA.unaryCalls).toHaveLength(0);

    // Cancelled mid-flight
    const midFlightController = new AbortController();
    fakeAdapterA.setUnaryDelayMs(100);

    const callPromise = useCase.executeUnary(basePayload, midFlightController.signal);
    setTimeout(() => midFlightController.abort(new Error('Mid-flight cancellation')), 20);

    await expect(callPromise).rejects.toThrow(RequestCancelledError);
  });

  it('aborts retry backoff sleep immediately when parentSignal fires during backoff delay', async () => {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore();
    const fakeAdapterA = new FakeProviderAdapter('test-provider', {
      unaryHandler: async () => {
        throw new RateLimitExceededError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
      },
    });
    const fakeAdapterB = new FakeProviderAdapter('openai');
    adapterRegistry.register(fakeAdapterA);
    adapterRegistry.register(fakeAdapterB);

    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      retryPolicy: {
        maxAttemptsPerTarget: 3,
        maxFallbackAttempts: 2,
        maxTotalExecutionAttempts: 4,
        initialBackoffDelayMs: 1000,
        maxBackoffDelayMs: 2000,
        backoffMultiplier: 2.0,
      },
    });

    const { basePayload } = createFixture();
    const abortController = new AbortController();
    const callPromise = useCase.executeUnary(basePayload, abortController.signal);

    // Abort after adapter failed, while useCase is sleeping in jitter backoff
    setTimeout(() => abortController.abort(new Error('Aborted during backoff')), 20);

    await expect(callPromise).rejects.toThrow(RequestCancelledError);
  });

  it('respects injected retryPolicy overriding default attempt limits', async () => {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore();
    const fakeAdapterA = new FakeProviderAdapter('test-provider');
    const fakeAdapterB = new FakeProviderAdapter('openai');
    adapterRegistry.register(fakeAdapterA);
    adapterRegistry.register(fakeAdapterB);

    // Injected config: maxAttemptsPerTarget = 1 (do not retry in-target, fall back immediately)
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      retryPolicy: {
        maxAttemptsPerTarget: 1,
        maxFallbackAttempts: 2,
        maxTotalExecutionAttempts: 4,
        initialBackoffDelayMs: 10,
        maxBackoffDelayMs: 50,
        backoffMultiplier: 1.5,
      },
    });

    fakeAdapterA.enqueueUnaryResponse(async () => {
      throw new RateLimitExceededError('oicunt.model.catalog-alpha', 'corr-1', 'target-primary');
    });

    const { basePayload } = createFixture();
    const result = await useCase.executeUnary(basePayload);

    // Primary target was attempted only 1 time because maxAttemptsPerTarget = 1
    expect(fakeAdapterA.unaryCalls).toHaveLength(1);
    // Fallback was immediately invoked
    expect(fakeAdapterB.unaryCalls).toHaveLength(1);
    expect(result.completionId).toBeDefined();
  });
});
