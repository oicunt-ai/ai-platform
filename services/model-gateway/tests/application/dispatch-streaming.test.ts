import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@oicunt-ai/ai-types';
import type {
  GatewayDispatchPayload,
  ResolvedTargetDto,
} from '../../src/application/dtos/dispatch.dto.js';
import { DispatchModelUseCase } from '../../src/application/use-cases/dispatch-model.use-case.js';
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { InMemoryCircuitBreakerStore } from '../../src/infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

describe('DispatchModelUseCase - Streaming Execution', () => {
  function createStreamingFixture() {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore();

    const fakeAdapterA = new FakeProviderAdapter('anthropic');
    const fakeAdapterB = new FakeProviderAdapter('openai');
    adapterRegistry.register(fakeAdapterA);
    adapterRegistry.register(fakeAdapterB);

    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
    });

    const targets: ResolvedTargetDto[] = [
      {
        targetId: 'target-primary',
        provider: 'anthropic',
        upstreamModelId: 'primary-model',
        priority: 1,
        weight: 100,
        supportsStreaming: true,
      },
      {
        targetId: 'target-secondary',
        provider: 'openai',
        upstreamModelId: 'secondary-model',
        priority: 2,
        weight: 100,
        supportsStreaming: true,
      },
    ];

    const basePayload: GatewayDispatchPayload = {
      requestId: 'req-stream-1',
      correlationId: 'corr-stream-1',
      canonicalModelId: 'claude-sonnet',
      version: '1.0.0',
      stream: true,
      messages: [{ role: 'user', content: 'Stream me a story' }],
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
    };

    return { useCase, fakeAdapterA, fakeAdapterB, basePayload };
  }

  it('streams tokens and finishes cleanly', async () => {
    const { useCase, fakeAdapterA, basePayload } = createStreamingFixture();

    fakeAdapterA.setStreamEvents([
      { event: 'token', data: { delta: 'Once ' } },
      { event: 'token', data: { delta: 'upon ' } },
      { event: 'token', data: { delta: 'a time' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 4, completionTokens: 4, totalTokens: 8 },
        },
      },
    ]);

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream(basePayload)) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events[0]?.event).toBe('token');
    expect(events[3]?.event).toBe('finish');
    expect(fakeAdapterA.streamCalls).toHaveLength(1);
  });

  it('falls back to secondary target if primary fails BEFORE any token is emitted', async () => {
    const { useCase, fakeAdapterA, fakeAdapterB, basePayload } = createStreamingFixture();

    // Primary fails immediately on first event
    fakeAdapterA.setStreamEvents([
      { event: 'error', data: { code: 'PROVIDER_ERROR', message: 'Provider internal error' } },
    ]);

    // Secondary succeeds
    fakeAdapterB.setStreamEvents([
      { event: 'token', data: { delta: 'Fallback token' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
        },
      },
    ]);

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream(basePayload)) {
      events.push(event);
    }

    expect(fakeAdapterA.streamCalls).toHaveLength(1);
    expect(fakeAdapterB.streamCalls).toHaveLength(1);
    expect(events).toHaveLength(2);
    expect((events[0]?.data as { delta: string }).delta).toBe('Fallback token');
  });

  it('FORBIDS fallback/retry once any token has been yielded to caller (Streaming Invariant 3)', async () => {
    const { useCase, fakeAdapterA, fakeAdapterB, basePayload } = createStreamingFixture();

    // Primary yields one token, then encounters an error
    fakeAdapterA.setStreamEvents([
      { event: 'token', data: { delta: 'First chunk sent' } },
      { event: 'error', data: { code: 'CONNECTION_RESET', message: 'Network severed mid-stream' } },
    ]);

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream(basePayload)) {
      events.push(event);
    }

    // Must receive token and then error event. Must NOT fall back to B!
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe('token');
    expect(events[1]?.event).toBe('error');
    expect((events[1]?.data as { code: string }).code).toBe('STREAM_INTERRUPTED');

    // Adapter B must NEVER be called
    expect(fakeAdapterB.streamCalls).toHaveLength(0);
  });

  it('propagates cancellation signal to provider when stream is aborted', async () => {
    const { useCase, fakeAdapterA, basePayload } = createStreamingFixture();

    fakeAdapterA.setStreamDelayMs(50);
    fakeAdapterA.setStreamEvents([
      { event: 'token', data: { delta: 'Chunk 1' } },
      { event: 'token', data: { delta: 'Chunk 2' } },
      { event: 'token', data: { delta: 'Chunk 3' } },
    ]);

    const abortController = new AbortController();

    const streamPromise = (async () => {
      const collected: StreamEvent[] = [];
      for await (const event of useCase.executeStream(basePayload, abortController.signal)) {
        collected.push(event);
        if (collected.length === 1) {
          abortController.abort(new Error('Caller aborted stream'));
        }
      }
      return collected;
    })();

    const result = await streamPromise;
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Cancellation signal was forwarded to adapter
    expect(fakeAdapterA.streamCalls[0]?.cancellationSignal.aborted).toBe(true);
  });

  it('skips non-streaming target and dispatches to next eligible streaming target (Fix 3)', async () => {
    const adapterRegistry = new InMemoryAdapterRegistry();
    const circuitBreakerStore = new InMemoryCircuitBreakerStore();

    const nonStreamingAdapter = new FakeProviderAdapter('local');
    const streamingAdapter = new FakeProviderAdapter('custom');
    adapterRegistry.register(nonStreamingAdapter);
    adapterRegistry.register(streamingAdapter);

    const useCase = new DispatchModelUseCase({
      adapterRegistry,
      circuitBreakerStore,
    });

    const targets: ResolvedTargetDto[] = [
      {
        targetId: 'target-batch-only',
        provider: 'local' as const,
        upstreamModelId: 'batch-model',
        priority: 1,
        weight: 100,
        supportsStreaming: false, // does NOT support streaming
      },
      {
        targetId: 'target-stream-capable',
        provider: 'custom' as const,
        upstreamModelId: 'streaming-model',
        priority: 2,
        weight: 100,
        supportsStreaming: true, // supports streaming
      },
    ];

    streamingAdapter.setStreamEvents([
      { event: 'token', data: { delta: 'Streaming capability passed' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 3, completionTokens: 3, totalTokens: 6 },
        },
      },
    ]);

    const { basePayload } = createStreamingFixture();
    const payload: GatewayDispatchPayload = {
      ...basePayload,
      eligibleTargets: targets,
    };

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream(payload)) {
      events.push(event);
    }

    // Non-streaming adapter was skipped completely
    expect(nonStreamingAdapter.streamCalls).toHaveLength(0);
    // Streaming adapter was invoked
    expect(streamingAdapter.streamCalls).toHaveLength(1);
    expect(events).toHaveLength(2);
    expect((events[0]?.data as { delta: string }).delta).toBe('Streaming capability passed');
  });

  it('yields REQUEST_CANCELLED error when parentSignal is already aborted before first stream event (Fix 5)', async () => {
    const { useCase, fakeAdapterA, basePayload } = createStreamingFixture();

    const preAbortedController = new AbortController();
    preAbortedController.abort(new Error('Pre-aborted stream'));

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream(basePayload, preAbortedController.signal)) {
      events.push(event);
    }

    // Must yield REQUEST_CANCELLED and not ALL_TARGETS_EXHAUSTED
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('error');
    expect((events[0]?.data as { code: string }).code).toBe('REQUEST_CANCELLED');
    expect(fakeAdapterA.streamCalls).toHaveLength(0);
  });
});
