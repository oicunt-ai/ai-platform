import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@oicunt-ai/ai-types';
import type { InferenceExecutionContext } from '../../src/domain/types.js';
import type { InferenceExecutionRequest } from '../../src/application/dtos/inference-execution.dto.js';
import { ExecuteInferenceUseCase } from '../../src/application/use-cases/execute-inference.use-case.js';
import { InferenceTimeoutError, RequestCancelledError } from '../../src/domain/errors.js';
import type { InferenceHookPort } from '../../src/application/ports/inference-hook.port.js';
import { FakeModelGateway } from '../test-doubles/fake-model-gateway.js';

describe('Application - ExecuteInferenceUseCase', () => {
  const baseRequest: InferenceExecutionRequest = {
    requestId: 'req_test_01',
    correlationId: 'corr_test_01',
    actorId: 'test-user',
    version: '1.0.0',
    stream: false,
    canonicalModelId: 'oicunt.model.catalog-alpha',
    messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }],
    limits: {
      contextWindowTokens: 200_000,
      maxOutputTokens: 8192,
    },
    deadlineMs: Date.now() + 60_000,
    pricing: {
      costPerMillionInputTokens: 3.0,
      costPerMillionOutputTokens: 15.0,
    },
  };

  const baseContext: InferenceExecutionContext = {
    requestId: 'req_test_01',
    correlationId: 'corr_test_01',
    actorId: 'test-user',
    tenantId: 'org_test',
    serviceName: 'ai-orchestrator',
  };

  describe('executeUnary', () => {
    it('executes unary request successfully and computes cost', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const response = await useCase.executeUnary(baseRequest, baseContext);

      expect(response.success).toBe(true);
      expect(response.data.model).toBe('oicunt.model.catalog-alpha');
      expect(response.data.finishReason).toBe('stop');
      expect(response.data.usage.totalTokens).toBe(45);
      expect(response.data.metadata.estimatedCostUsd).toBeDefined();
      expect(response.data.metadata.estimatedCostUsd).toBeGreaterThan(0);
      expect(response.meta.requestId).toBe('req_test_01');
      expect(response.meta.correlationId).toBe('corr_test_01');

      // Invariant: no provider or target details in response
      expect(
        (response.data as unknown as Record<string, unknown>)['targetExecuted'],
      ).toBeUndefined();
      expect((response.data as unknown as Record<string, unknown>)['provider']).toBeUndefined();
    });

    it('strips thinking blocks when exposeReasoning is false', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
        privacyPolicy: {
          exposeReasoning: false,
          redactThinking: true,
          redactThinkingInLogs: true,
        },
      });

      const requestWithEffort: InferenceExecutionRequest = {
        ...baseRequest,
        effort: 'high',
      };

      const response = await useCase.executeUnary(requestWithEffort, baseContext);
      expect(response.success).toBe(true);

      const content = response.data.message.content;
      if (Array.isArray(content)) {
        const hasThinking = content.some((p) => p.type === 'thinking');
        expect(hasThinking).toBe(false);
      } else {
        expect(typeof content).toBe('string');
      }
    });

    it('invokes lifecycle hooks before and after execution', async () => {
      const fakeGateway = new FakeModelGateway();
      let beforeCalled = false;
      let afterCalled = false;

      const testHook: InferenceHookPort = {
        beforeExecution: async (req, signal) => {
          beforeCalled = true;
          expect(req.canonicalModelId).toBe('oicunt.model.catalog-alpha');
          expect(signal).toBeDefined();
        },
        afterExecution: async (_req, result, signal) => {
          afterCalled = true;
          expect(result.model).toBe('oicunt.model.catalog-alpha');
          expect(signal).toBeDefined();
        },
      };

      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
        hook: testHook,
      });

      await useCase.executeUnary(baseRequest, baseContext);
      expect(beforeCalled).toBe(true);
      expect(afterCalled).toBe(true);
    });

    it('throws InferenceTimeoutError when deadline has expired', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const expiredRequest: InferenceExecutionRequest = {
        ...baseRequest,
        deadlineMs: Date.now() - 50,
      };

      await expect(useCase.executeUnary(expiredRequest, baseContext)).rejects.toThrow(
        InferenceTimeoutError,
      );
    });

    it('handles parent signal abort before execution', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const abortController = new AbortController();
      abortController.abort();

      await expect(
        useCase.executeUnary(baseRequest, baseContext, abortController.signal),
      ).rejects.toThrow(RequestCancelledError);
    });

    it('handles parent signal abort during execution', async () => {
      const fakeGateway = new FakeModelGateway();
      fakeGateway.delayMs = 200;

      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const abortController = new AbortController();
      setTimeout(() => abortController.abort(), 20);

      await expect(
        useCase.executeUnary(baseRequest, baseContext, abortController.signal),
      ).rejects.toThrow(RequestCancelledError);
    });
  });

  describe('executeStream', () => {
    it('streams events successfully and records TTFT', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const events: StreamEvent[] = [];
      for await (const event of useCase.executeStream(baseRequest, baseContext)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      const tokenEvents = events.filter((e) => e.event === 'token');
      expect(tokenEvents.length).toBe(2);
      const finishEvents = events.filter((e) => e.event === 'finish');
      expect(finishEvents.length).toBe(1);
    });

    it('filters thinking events when exposeReasoning is false', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
        privacyPolicy: {
          exposeReasoning: false,
          redactThinking: true,
          redactThinkingInLogs: true,
        },
      });

      const requestWithEffort: InferenceExecutionRequest = {
        ...baseRequest,
        effort: 'high',
      };

      const events: StreamEvent[] = [];
      for await (const event of useCase.executeStream(requestWithEffort, baseContext)) {
        events.push(event);
      }

      const thinkingEvents = events.filter((e) => e.event === 'thinking');
      expect(thinkingEvents.length).toBe(0);
      expect(events.some((e) => e.event === 'token')).toBe(true);
    });

    it('enforces Zero Mid-Stream Retry Invariant: emits error event if failure occurs mid-stream', async () => {
      const fakeGateway = new FakeModelGateway();
      // Emits one token then fails
      fakeGateway.customStreamEvents = [{ event: 'token', data: { delta: 'Partial chunk' } }];
      // Make it fail after yielding
      const failingStream = async function* (): AsyncIterable<StreamEvent> {
        yield { event: 'token', data: { delta: 'First token' } };
        throw new Error('Connection reset mid-stream');
      };
      fakeGateway.dispatchStream = () => failingStream();

      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const events: StreamEvent[] = [];
      // Should not throw, but emit terminal error event
      for await (const event of useCase.executeStream(baseRequest, baseContext)) {
        events.push(event);
      }

      expect(events.length).toBe(2);
      expect(events[0]?.event).toBe('token');
      expect(events[1]?.event).toBe('error');
      expect((events[1]?.data as { message: string }).message).toContain(
        'Connection reset mid-stream',
      );
    });

    it('throws directly if failure occurs before emitting any token', async () => {
      const fakeGateway = new FakeModelGateway();
      fakeGateway.shouldFailStreamWith = new Error('Gateway connection refused');

      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const consume = async () => {
        for await (const _ of useCase.executeStream(baseRequest, baseContext)) {
          // do nothing
        }
      };

      await expect(consume()).rejects.toThrow();
    });
  });

  describe('Routing Metadata Pass-Through Invariant', () => {
    it('passes through arbitrary eligibleTargets and routingPolicy to Model Gateway without inspection or alteration in unary execution', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const arbitraryTargets = [
        { targetId: 't-primary', provider: 'test-provider', customGatewayParam: 42 },
        { targetId: 't-secondary', provider: 'bedrock', customGatewayParam: 99 },
      ];
      const arbitraryRoutingPolicy = {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 2,
        customCircuitBreakerConfig: { failureThreshold: 5 },
      };

      const requestWithRouting: InferenceExecutionRequest = {
        ...baseRequest,
        eligibleTargets: arbitraryTargets,
        routingPolicy: arbitraryRoutingPolicy,
      };

      await useCase.executeUnary(requestWithRouting, baseContext);

      expect(fakeGateway.recordedDispatches).toHaveLength(1);
      const dispatched = fakeGateway.recordedDispatches[0];
      expect(dispatched?.eligibleTargets).toBe(arbitraryTargets);
      expect(dispatched?.routingPolicy).toBe(arbitraryRoutingPolicy);
    });

    it('passes through arbitrary eligibleTargets and routingPolicy in streaming execution without alteration', async () => {
      const fakeGateway = new FakeModelGateway();
      const useCase = new ExecuteInferenceUseCase({
        modelGateway: fakeGateway,
      });

      const arbitraryTargets = [{ targetId: 'target-stream', provider: 'google' }];
      const arbitraryRoutingPolicy = { strategy: 'lowest-latency' };

      const requestWithRouting: InferenceExecutionRequest = {
        ...baseRequest,
        stream: true,
        eligibleTargets: arbitraryTargets,
        routingPolicy: arbitraryRoutingPolicy,
      };

      for await (const _ of useCase.executeStream(requestWithRouting, baseContext)) {
        // consume stream
      }

      expect(fakeGateway.recordedDispatches).toHaveLength(1);
      const dispatched = fakeGateway.recordedDispatches[0];
      expect(dispatched?.eligibleTargets).toBe(arbitraryTargets);
      expect(dispatched?.routingPolicy).toBe(arbitraryRoutingPolicy);
    });
  });
});
