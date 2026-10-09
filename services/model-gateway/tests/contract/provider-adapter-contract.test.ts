import { describe, expect, it } from 'vitest';
import type {
  IProviderAdapter,
  ProviderExecutionRequest,
} from '../../src/application/ports/provider-adapter.port.js';
import { FakeProviderAdapter } from '../test-doubles/fake-provider-adapter.js';

describe('IProviderAdapter Port Contract Conformance', () => {
  function createSampleExecutionRequest(signal: AbortSignal): ProviderExecutionRequest {
    const target = {
      targetId: 'target-mock',
      provider: 'custom' as const,
      upstreamModelId: 'mock-model-v1',
      priority: 1,
      weight: 100,
      supportsStreaming: true,
    };

    return {
      requestId: 'test-req-id',
      correlationId: 'test-corr-id',
      completionId: 'test-comp-id',
      attemptTimeoutMs: 5000,
      cancellationSignal: signal,
      target,
      payload: {
        requestId: 'test-req-id',
        correlationId: 'test-corr-id',
        canonicalModelId: 'oicunt.model.catalog-alpha',
        version: '1.0.0',
        stream: false,
        messages: [{ role: 'user', content: 'Say hello' }],
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
      },
    };
  }

  it('adheres to IProviderAdapter port signature and returns NormalizedCompletionData', async () => {
    const adapter: IProviderAdapter = new FakeProviderAdapter('custom');
    expect(adapter.provider).toBe('custom');

    const controller = new AbortController();
    const req = createSampleExecutionRequest(controller.signal);

    const unaryResult = await adapter.executeUnary(req);
    expect(unaryResult.completionId).toBeDefined();
    expect(unaryResult.message).toBeDefined();
    expect(unaryResult.message.role).toBe('assistant');
    expect(unaryResult.usage).toBeDefined();

    const isHealthy = await adapter.healthCheck(req.target);
    expect(typeof isHealthy).toBe('boolean');
    expect(isHealthy).toBe(true);
  });

  it('yields StreamEvent items conforming to discriminated union via executeStream', async () => {
    const adapter: IProviderAdapter = new FakeProviderAdapter('custom');
    const controller = new AbortController();
    const req = createSampleExecutionRequest(controller.signal);

    const events = [];
    for await (const event of adapter.executeStream(req)) {
      events.push(event);
      expect(['token', 'thinking', 'tool_call', 'finish', 'error']).toContain(event.event);
    }

    expect(events.length).toBeGreaterThan(0);
    const finish = events.find((e) => e.event === 'finish');
    expect(finish).toBeDefined();
  });

  it('aborts execution when cancellationSignal fires', async () => {
    const adapter = new FakeProviderAdapter('custom');
    adapter.setUnaryDelayMs(100);

    const controller = new AbortController();
    const req = createSampleExecutionRequest(controller.signal);

    setTimeout(() => controller.abort(new Error('Contract test abort')), 20);

    await expect(adapter.executeUnary(req)).rejects.toThrow();
  });
});
