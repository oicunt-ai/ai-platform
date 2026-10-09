import { describe, expect, it } from 'vitest';
import type { NormalizedCompletionData, StreamEvent } from '@oicunt-ai/ai-types';
import type {
  GatewayDispatchPayload,
  ResolvedTargetDto,
} from '../../src/application/dtos/dispatch.dto.js';
import { DispatchModelUseCase } from '../../src/application/use-cases/dispatch-model.use-case.js';
import { InMemoryAdapterRegistry } from '../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { InMemoryCircuitBreakerStore } from '../../src/infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

describe('Reasoning Privacy Boundary (Invariant 7)', () => {
  const target: ResolvedTargetDto = {
    targetId: 't-1',
    provider: 'test-provider',
    upstreamModelId: 'provider-model-alpha-v2',
    priority: 1,
    weight: 100,
    supportsStreaming: true,
  };

  it('filters thinking blocks from unary response by default (exposeReasoning omitted or false)', async () => {
    const adapter = new FakeProviderAdapter('test-provider');
    const registry = new InMemoryAdapterRegistry();
    registry.register(adapter);

    const useCase = new DispatchModelUseCase({
      adapterRegistry: registry,
      circuitBreakerStore: new InMemoryCircuitBreakerStore(),
    });

    adapter.enqueueUnaryResponse(async (req) => {
      const response: NormalizedCompletionData = {
        completionId: req.completionId,
        model: req.payload.canonicalModelId,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Private internal reasoning step' },
            { type: 'text', text: 'Public answer to user question' },
          ],
        },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        latencyMs: 25,
      };
      return response;
    });

    const payload: GatewayDispatchPayload = {
      requestId: 'req-priv-1',
      correlationId: 'corr-priv-1',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      version: '1.0.0',
      stream: false,
      exposeReasoning: false,
      messages: [{ role: 'user', content: 'Explain quantum computing' }],
      limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      eligibleTargets: [target],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      actorId: 'test-actor',
    };

    const result = await useCase.executeUnary(payload);
    const content = result.message.content;

    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe('text');
      expect((content[0] as { text: string }).text).toBe('Public answer to user question');
    }
  });

  it('preserves thinking blocks in unary response when exposeReasoning is true', async () => {
    const adapter = new FakeProviderAdapter('test-provider');
    const registry = new InMemoryAdapterRegistry();
    registry.register(adapter);

    const useCase = new DispatchModelUseCase({
      adapterRegistry: registry,
      circuitBreakerStore: new InMemoryCircuitBreakerStore(),
    });

    adapter.enqueueUnaryResponse(async (req) => {
      return {
        completionId: req.completionId,
        model: req.payload.canonicalModelId,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Allowed reasoning step' },
            { type: 'text', text: 'Answer' },
          ],
        },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        latencyMs: 20,
      };
    });

    const payload: GatewayDispatchPayload = {
      requestId: 'req-priv-2',
      correlationId: 'corr-priv-2',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      version: '1.0.0',
      stream: false,
      exposeReasoning: true,
      messages: [{ role: 'user', content: 'Explain quantum computing' }],
      limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      eligibleTargets: [target],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      actorId: 'test-actor',
    };

    const result = await useCase.executeUnary(payload);
    const content = result.message.content;

    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      expect(content).toHaveLength(2);
      expect(content[0]?.type).toBe('thinking');
    }
  });

  it('drops thinking events from streaming response when exposeReasoning is not true', async () => {
    const adapter = new FakeProviderAdapter('test-provider');
    const registry = new InMemoryAdapterRegistry();
    registry.register(adapter);

    const useCase = new DispatchModelUseCase({
      adapterRegistry: registry,
      circuitBreakerStore: new InMemoryCircuitBreakerStore(),
    });

    adapter.setStreamEvents([
      { event: 'thinking', data: { delta: 'Secret internal reasoning' } },
      { event: 'token', data: { delta: 'Public text' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ]);

    const payload: GatewayDispatchPayload = {
      requestId: 'req-priv-3',
      correlationId: 'corr-priv-3',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      version: '1.0.0',
      stream: true,
      exposeReasoning: false,
      messages: [{ role: 'user', content: 'Hi' }],
      limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      eligibleTargets: [target],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      actorId: 'test-actor',
    };

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream(payload)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events.find((e) => e.event === 'thinking')).toBeUndefined();
    expect(events[0]?.event).toBe('token');
    expect(events[1]?.event).toBe('finish');
  });

  it('forwards thinking events in stream when exposeReasoning is true', async () => {
    const adapter = new FakeProviderAdapter('test-provider');
    const registry = new InMemoryAdapterRegistry();
    registry.register(adapter);

    const useCase = new DispatchModelUseCase({
      adapterRegistry: registry,
      circuitBreakerStore: new InMemoryCircuitBreakerStore(),
    });

    adapter.setStreamEvents([
      { event: 'thinking', data: { delta: 'Allowed streaming thought' } },
      { event: 'token', data: { delta: 'Public text' } },
      {
        event: 'finish',
        data: {
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      },
    ]);

    const payload: GatewayDispatchPayload = {
      requestId: 'req-priv-4',
      correlationId: 'corr-priv-4',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      version: '1.0.0',
      stream: true,
      exposeReasoning: true,
      messages: [{ role: 'user', content: 'Hi' }],
      limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      eligibleTargets: [target],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      actorId: 'test-actor',
    };

    const events: StreamEvent[] = [];
    for await (const event of useCase.executeStream(payload)) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]?.event).toBe('thinking');
    expect(events[1]?.event).toBe('token');
  });
});
