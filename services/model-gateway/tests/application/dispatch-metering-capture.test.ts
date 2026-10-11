/**
 * Regression tests for durable metering capture in DispatchModelUseCase.
 *
 * Proves the Task 25A defects stay fixed: provider outcomes and metering
 * outcomes are strictly separated, capture precedes any success signal,
 * interruptions have defined accounting, and a disabled capture preserves
 * existing execution behavior. No broker, database, or provider is
 * contacted; the capture transport is faked.
 */
import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@oicunt-ai/ai-types';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import type {
  GatewayDispatchPayload,
  ResolvedTargetDto,
} from '../../src/application/dtos/dispatch.dto.js';
import { DispatchModelUseCase } from '../../src/application/use-cases/dispatch-model.use-case.js';
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { InMemoryCircuitBreakerStore } from '../../src/infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import type { MeteringCapturePort } from '../../src/application/ports/metering-capture.port.js';
import { MeteringCaptureUnavailableError } from '../../src/domain/errors.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

type CaptureMode = 'ok' | 'fail' | 'hang';

function fakeCapture(mode: CaptureMode = 'ok'): MeteringCapturePort & {
  captured: UsageEvent[];
} {
  const captured: UsageEvent[] = [];
  return {
    captured,
    async capture(event: UsageEvent, options?: { timeoutMs?: number | undefined }) {
      if (mode === 'fail') {
        throw new MeteringCaptureUnavailableError('oicunt.model.test', 'corr-test');
      }
      if (mode === 'hang') {
        // Faithful to the capture contract: the transport layer enforces
        // the timeout and rejects; the use case only handles the outcome.
        await new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new MeteringCaptureUnavailableError('oicunt.model.test', 'corr-test')),
            options?.timeoutMs ?? 2000,
          );
        });
      }
      captured.push(event);
    },
  };
}

function createFixture() {
  const adapterRegistry = new InMemoryAdapterRegistry();
  const circuitBreakerStore = new InMemoryCircuitBreakerStore();
  const fakeAdapter = new FakeProviderAdapter('test-provider');
  adapterRegistry.register(fakeAdapter);

  const targets: ResolvedTargetDto[] = [
    {
      targetId: 'target-primary',
      provider: 'test-provider',
      upstreamModelId: 'primary-model',
      priority: 1,
      weight: 100,
      supportsStreaming: true,
    },
  ];

  const basePayload: GatewayDispatchPayload = {
    requestId: 'req-metering-1',
    correlationId: 'corr-metering-1',
    canonicalModelId: 'oicunt.model.test',
    version: '1.0.0',
    stream: false,
    messages: [{ role: 'user', content: 'Hello' }],
    limits: {
      contextWindowTokens: 100000,
      maxOutputTokens: 4096,
    },
    pricing: {
      costPerMillionInputTokens: 3.0,
      costPerMillionOutputTokens: 15.0,
    },
    eligibleTargets: targets,
    routingPolicy: {
      strategy: 'priority-fallback',
      maxFallbackAttempts: 2,
      requireHealthyTarget: true,
      degradationBehavior: 'fail-fast',
    },
    actorId: 'test-actor',
    tenantId: 'tenant-1',
    userId: 'user-1',
  };

  return { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload };
}

function breakerSnapshot(
  circuitBreakerStore: InMemoryCircuitBreakerStore,
  targetId = 'target-primary',
) {
  return circuitBreakerStore.getBreaker(targetId).getSnapshot();
}

describe('DispatchModelUseCase durable metering capture (unary)', () => {
  it('captures the success event durably before returning the result', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    const order: string[] = [];
    fakeAdapter.enqueueUnaryResponse(async (req) => {
      order.push('provider');
      return {
        completionId: req.completionId,
        model: req.payload.canonicalModelId,
        message: { role: 'assistant', content: 'hi' },
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          usageSource: 'provider' as const,
        },
        latencyMs: 5,
      };
    });
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: {
        async capture(event) {
          order.push('capture');
          await capture.capture(event);
        },
      },
    });

    const result = await useCase.executeUnary(basePayload);

    expect(order).toEqual(['provider', 'capture']);
    expect(result.finishReason).toBe('stop');
    expect(capture.captured).toHaveLength(1);
    const event = capture.captured[0]!;
    expect(event.measurements['tokens.total']).toBe(30);
    expect(event.measurements['units.requests']).toBe(1);
    expect(event.dimensions['usageSource']).toBe('provider');
    expect(event.idempotencyKey.startsWith('model.completion:')).toBe(true);
    expect(breakerSnapshot(circuitBreakerStore).failureCount).toBe(0);
  });

  it('fails closed with METERING_CAPTURE_UNAVAILABLE without retrying the provider', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: fakeCapture('fail'),
    });

    const failure = await useCase.executeUnary(basePayload).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(MeteringCaptureUnavailableError);
    expect((failure as MeteringCaptureUnavailableError).code).toBe('METERING_CAPTURE_UNAVAILABLE');
    // Exactly one provider attempt: capture failure never triggers another call.
    expect(fakeAdapter.unaryCalls).toHaveLength(1);
    // The provider target is not blamed: success recorded, zero failures.
    const snapshot = breakerSnapshot(circuitBreakerStore);
    expect(snapshot.failureCount).toBe(0);
    expect(snapshot.totalRequests).toBe(1);
  });

  it('treats a capture timeout like a capture failure', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: fakeCapture('hang'),
      meteringCaptureTimeoutMs: 20,
    });

    const failure = await useCase.executeUnary(basePayload).then(
      () => null,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(MeteringCaptureUnavailableError);
    expect(fakeAdapter.unaryCalls).toHaveLength(1);
    expect(breakerSnapshot(circuitBreakerStore).failureCount).toBe(0);
  });

  it('rejects a missing tenant before any provider call when metering is enabled', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: capture,
    });

    const withoutTenant = { ...basePayload, tenantId: undefined };
    const failure = await useCase.executeUnary(withoutTenant).then(
      () => null,
      (err: unknown) => err,
    );
    expect((failure as { code?: string })?.code).toBe('INTERNAL_GATEWAY_ERROR');
    // Pre-provider billing-identity gate: no provider tokens consumed, no
    // event captured, no breaker verdict recorded.
    expect(fakeAdapter.unaryCalls).toHaveLength(0);
    expect(capture.captured).toHaveLength(0);
    expect(breakerSnapshot(circuitBreakerStore).failureCount).toBe(0);
    expect(breakerSnapshot(circuitBreakerStore).totalRequests).toBe(0);
  });

  it('preserves existing execution behavior when capture is disabled', async () => {
    const { adapterRegistry, circuitBreakerStore, basePayload } = createFixture();
    const useCase = new DispatchModelUseCase({ adapterRegistry, circuitBreakerStore });
    const result = await useCase.executeUnary(basePayload);
    expect(result.finishReason).toBe('stop');
    expect(result.usage.totalTokens).toBe(30);
  });

  it('still records genuine provider failures on the breaker', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    fakeAdapter.enqueueUnaryResponse(async () => {
      throw new Error('provider exploded');
    });
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: capture,
      retryPolicy: {
        maxAttemptsPerTarget: 1,
        maxFallbackAttempts: 0,
        maxTotalExecutionAttempts: 1,
        initialBackoffDelayMs: 0,
        maxBackoffDelayMs: 0,
        backoffMultiplier: 1,
      },
    });

    await expect(useCase.executeUnary(basePayload)).rejects.toThrow();
    expect(breakerSnapshot(circuitBreakerStore).failureCount).toBe(1);
    // The failed attempt itself is captured for accounting (bounded, best effort).
    expect(capture.captured).toHaveLength(1);
    expect(capture.captured[0]?.dimensions['usageSource']).toBe('unknown');
    expect(capture.captured[0]?.measurements['tokens.total']).toBeUndefined();
  });
});

describe('DispatchModelUseCase durable metering capture (streaming)', () => {
  it('captures before yielding finish, never relying on code after yield', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    fakeAdapter.setStreamEvents([
      { event: 'token', data: { delta: 'hi' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
        },
      },
    ]);
    const order: string[] = [];
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: {
        async capture(event) {
          order.push('capture');
          await capture.capture(event);
        },
      },
    });

    for await (const event of useCase.executeStream({ ...basePayload, stream: true })) {
      order.push(event.event);
    }

    expect(order).toEqual(['token', 'capture', 'finish']);
    expect(capture.captured).toHaveLength(1);
  });

  it('yields an honest error instead of finish when capture fails', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    fakeAdapter.setStreamEvents([
      { event: 'token', data: { delta: 'hi' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
        },
      },
    ]);
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: fakeCapture('fail'),
    });

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream({ ...basePayload, stream: true })) {
      events.push(event);
    }

    expect(events.map((e) => e.event)).toEqual(['token', 'error']);
    const terminal = events[1]!;
    expect(terminal.event).toBe('error');
    if (terminal.event === 'error') {
      expect(terminal.data.code).toBe('METERING_CAPTURE_UNAVAILABLE');
    }
    // Tokens were already streamed: no retry, no provider blame.
    expect(fakeAdapter.streamCalls).toHaveLength(1);
    expect(breakerSnapshot(circuitBreakerStore).failureCount).toBe(0);
  });

  it('gives a clean stream end without finish a defined metering outcome', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    fakeAdapter.setStreamEvents([{ event: 'token', data: { delta: 'partial' } }]);
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: capture,
    });

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream({ ...basePayload, stream: true })) {
      events.push(event);
    }

    // Tokens were delivered but no finish arrived: interruption, not silence.
    expect(events.map((e) => e.event)).toEqual(['token', 'error']);
    const terminal = events[1]!;
    if (terminal.event === 'error') {
      expect(terminal.data.code).toBe('STREAM_INTERRUPTED');
    }
    expect(capture.captured).toHaveLength(1);
    expect(capture.captured[0]?.dimensions['outcome']).toBe('STREAM_INTERRUPTED');
    expect(capture.captured[0]?.dimensions['usageSource']).toBe('unknown');
    expect(capture.captured[0]?.measurements['tokens.total']).toBeUndefined();
  });

  it('records provider-reported counts when the failing stream carried usage', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    fakeAdapter.setStreamEvents([
      { event: 'token', data: { delta: 'partial' } },
      {
        event: 'error',
        data: {
          code: 'PROVIDER_ERROR',
          message: 'provider disconnected',
          usage: {
            promptTokens: 9,
            completionTokens: 4,
            totalTokens: 13,
            usageSource: 'provider' as const,
          },
        },
      },
    ]);
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: capture,
    });

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream({ ...basePayload, stream: true })) {
      events.push(event);
    }

    expect(events.map((e) => e.event)).toEqual(['token', 'error']);
    expect(capture.captured).toHaveLength(1);
    expect(capture.captured[0]?.measurements['tokens.total']).toBe(13);
    expect(capture.captured[0]?.measurements['tokens.input']).toBe(9);
    expect(capture.captured[0]?.dimensions['usageSource']).toBe('provider');
  });

  it('omits token keys when the failing stream carried no usage', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    fakeAdapter.setStreamEvents([
      { event: 'token', data: { delta: 'partial' } },
      { event: 'error', data: { code: 'CONNECTION_RESET', message: 'provider disconnected' } },
    ]);
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: capture,
    });

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream({ ...basePayload, stream: true })) {
      events.push(event);
    }

    expect(events.map((e) => e.event)).toEqual(['token', 'error']);
    expect(capture.captured).toHaveLength(1);
    expect(capture.captured[0]?.measurements).toEqual({ 'units.requests': 1 });
    expect(capture.captured[0]?.dimensions['usageSource']).toBe('unknown');
  });

  it('keeps attempt identity stable: one completionId per attempt', async () => {
    const { adapterRegistry, circuitBreakerStore, fakeAdapter, basePayload } = createFixture();
    const capture = fakeCapture('ok');
    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
      meteringCapture: capture,
    });

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream({ ...basePayload, stream: true })) {
      events.push(event);
    }
    expect(events.map((e) => e.event)).toEqual(['token', 'token', 'finish']);

    expect(capture.captured).toHaveLength(1);
    const event = capture.captured[0]!;
    const completionId = fakeAdapter.streamCalls[0]?.completionId;
    expect(event.eventId).toBe(`usage_${completionId}`);
    expect(event.idempotencyKey).toBe(`model.completion:${completionId}`);
  });
});
