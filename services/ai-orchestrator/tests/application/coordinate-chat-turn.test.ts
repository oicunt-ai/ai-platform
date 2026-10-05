import { beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalModelId, ReasoningEffortLevel } from '@oicunt-ai/model-types';
import type { TurnExecutionContext } from '../../src/domain/types.js';
import { CoordinateChatTurnUseCase } from '../../src/application/use-cases/coordinate-chat-turn.use-case.js';
import { InMemoryResolutionCache } from '../../src/infrastructure/cache/in-memory-resolution-cache.js';
import { FakeModelRegistry } from '../test-doubles/fake-model-registry.js';
import { FakeModelGateway } from '../test-doubles/fake-model-gateway.js';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  InvalidRequestError,
  ModelDeprecatedError,
  ModelInMaintenanceError,
  ModelNotFoundError,
  RequestCancelledError,
  UnsupportedEffortLevelError,
} from '../../src/domain/errors.js';

describe('Application - CoordinateChatTurnUseCase', () => {
  let fakeRegistry: FakeModelRegistry;
  let fakeGateway: FakeModelGateway;
  let cache: InMemoryResolutionCache;
  let useCase: CoordinateChatTurnUseCase;

  const mockContext: TurnExecutionContext = {
    turnId: 'turn_11111',
    requestId: 'req_22222',
    correlationId: 'corr_33333',
    actorId: 'test-actor',
    serviceName: 'billy-api',
    tenantId: 'ten_enterprise',
    userId: 'usr_alpha',
    startTime: Date.now(),
  };

  beforeEach(() => {
    fakeRegistry = new FakeModelRegistry();
    fakeGateway = new FakeModelGateway();
    cache = new InMemoryResolutionCache(60);
    useCase = new CoordinateChatTurnUseCase({
      modelRegistry: fakeRegistry,
      modelGateway: fakeGateway,
      resolutionCache: cache,
      defaultTimeoutMs: 120_000,
      maxTimeoutMs: 300_000,
    });
  });

  describe('Model Identity Preservation', () => {
    it('strictly preserves the user selected canonical model identity', async () => {
      const result = await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Hello Claude' }],
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.data.model).toBe('claude-sonnet');
      expect(fakeGateway.recordedDispatches).toHaveLength(1);
      expect(fakeGateway.recordedDispatches[0]?.canonicalModelId).toBe('claude-sonnet');
    });

    it('throws ModelNotFoundError if canonical model does not exist in registry', async () => {
      await expect(
        useCase.executeUnary(
          {
            model: 'non-existent-model' as unknown as CanonicalModelId,
            messages: [{ role: 'user', content: 'Hello' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(ModelNotFoundError);

      expect(fakeGateway.recordedDispatches).toHaveLength(0);
    });
  });

  describe('Reasoning Effort Governance', () => {
    it('applies requested effort when supported by model capabilities', async () => {
      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Solve this math problem' }],
          effort: 'high',
        },
        mockContext,
      );

      expect(fakeGateway.recordedDispatches[0]?.effort).toBe('high');
    });

    it('applies defaultEffortLevel from registry when effort is omitted for reasoning model', async () => {
      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Solve this math problem' }],
        },
        mockContext,
      );

      // Default in FakeModelRegistry is 'medium'
      expect(fakeGateway.recordedDispatches[0]?.effort).toBe('medium');
    });

    it('rejects requested effort if model does not support reasoning', async () => {
      await expect(
        useCase.executeUnary(
          {
            model: 'gpt-4o', // reasoning: false in registry
            messages: [{ role: 'user', content: 'Solve this' }],
            effort: 'high',
          },
          mockContext,
        ),
      ).rejects.toThrow(UnsupportedEffortLevelError);

      expect(fakeGateway.recordedDispatches).toHaveLength(0);
    });

    it('rejects unsupported effort level on a reasoning model', async () => {
      await expect(
        useCase.executeUnary(
          {
            model: 'claude-sonnet',
            messages: [{ role: 'user', content: 'Solve this' }],
            effort: 'ultra-maximum' as unknown as ReasoningEffortLevel,
          },
          mockContext,
        ),
      ).rejects.toThrow(UnsupportedEffortLevelError);

      expect(fakeGateway.recordedDispatches).toHaveLength(0);
    });
  });

  describe('System Prompt Harmonization', () => {
    it('prepends system message when messages list does not start with system', async () => {
      await useCase.executeUnary(
        {
          model: 'gpt-4o',
          systemPrompt: 'You are a helpful coding assistant.',
          messages: [{ role: 'user', content: 'Write hello world' }],
        },
        mockContext,
      );

      const dispatchedMessages = fakeGateway.recordedDispatches[0]?.messages;
      expect(dispatchedMessages).toHaveLength(2);
      expect(dispatchedMessages?.[0]).toEqual({
        role: 'system',
        content: 'You are a helpful coding assistant.',
      });
      expect(dispatchedMessages?.[1]?.role).toBe('user');
    });

    it('harmonizes with existing system message by appending delimiter', async () => {
      await useCase.executeUnary(
        {
          model: 'gpt-4o',
          systemPrompt: 'Follow strict formatting rules.',
          messages: [
            { role: 'system', content: 'Base instruction.' },
            { role: 'user', content: 'Write code' },
          ],
        },
        mockContext,
      );

      const dispatchedMessages = fakeGateway.recordedDispatches[0]?.messages;
      expect(dispatchedMessages).toHaveLength(2);
      expect(dispatchedMessages?.[0]).toEqual({
        role: 'system',
        content: 'Base instruction.\n\nFollow strict formatting rules.',
      });
    });
  });

  describe('Context Window Preflight Check', () => {
    it('rejects requests that exceed contextWindowTokens without invoking gateway', async () => {
      // Create message that clearly exceeds limits
      const hugePrompt = 'x'.repeat(600_000); // 600k chars -> ~150k tokens, limit is 128k for gpt-4o
      await expect(
        useCase.executeUnary(
          {
            model: 'gpt-4o',
            messages: [{ role: 'user', content: hugePrompt }],
          },
          mockContext,
        ),
      ).rejects.toThrow(ContextWindowExceededError);

      expect(fakeGateway.recordedDispatches).toHaveLength(0);
    });
  });

  describe('Model Availability States', () => {
    it('rejects model in maintenance with ModelInMaintenanceError (503)', async () => {
      await expect(
        useCase.executeUnary(
          {
            model: 'model-maintenance',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(ModelInMaintenanceError);

      expect(fakeGateway.recordedDispatches).toHaveLength(0);
    });

    it('rejects deprecated model with ModelDeprecatedError (410)', async () => {
      await expect(
        useCase.executeUnary(
          {
            model: 'model-deprecated',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(ModelDeprecatedError);

      expect(fakeGateway.recordedDispatches).toHaveLength(0);
    });

    it('rejects model with no eligible targets with AllTargetsExhaustedError (503)', async () => {
      await expect(
        useCase.executeUnary(
          {
            model: 'model-no-targets',
            messages: [{ role: 'user', content: 'Hello' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(AllTargetsExhaustedError);

      expect(fakeGateway.recordedDispatches).toHaveLength(0);
    });
  });

  describe('Resolution Caching', () => {
    it('uses L1 cache for subsequent turns avoiding redundant registry calls', async () => {
      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'First turn' }],
        },
        mockContext,
      );
      expect(fakeRegistry.recordedQueries).toHaveLength(1);

      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Second turn' }],
        },
        mockContext,
      );
      // Query count should still be 1 due to cache hit
      expect(fakeRegistry.recordedQueries).toHaveLength(1);
    });

    it('bypasses L1 cache and re-queries registry when bypassCache is true', async () => {
      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'First turn' }],
        },
        mockContext,
      );
      expect(fakeRegistry.recordedQueries).toHaveLength(1);

      // Normal turn hits cache
      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Second turn' }],
        },
        mockContext,
      );
      expect(fakeRegistry.recordedQueries).toHaveLength(1);

      // Bypass cache queries registry directly and updates cache
      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Third turn bypass' }],
        },
        { ...mockContext, bypassCache: true },
      );
      expect(fakeRegistry.recordedQueries).toHaveLength(2);

      // Subsequent turn uses newly refreshed cache
      await useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Fourth turn normal' }],
        },
        mockContext,
      );
      expect(fakeRegistry.recordedQueries).toHaveLength(2);
    });
  });

  describe('Model Registry Retries and Backoff', () => {
    it('does not retry when Model Registry throws InvalidRequestError', async () => {
      fakeRegistry.shouldFailWith = new InvalidRequestError(
        'Invalid model resolution parameter',
        mockContext.correlationId,
      );

      await expect(
        useCase.executeUnary(
          {
            model: 'claude-sonnet',
            messages: [{ role: 'user', content: 'Test prompt' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(InvalidRequestError);

      expect(fakeRegistry.recordedQueries).toHaveLength(1);
    });

    it('stops retry backoff immediately when AbortSignal is cancelled', async () => {
      fakeRegistry.shouldFailWith = new Error('Transient connection error');
      const abortController = new AbortController();

      const promise = useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Test cancellation' }],
        },
        mockContext,
        abortController.signal,
      );

      // Abort after a small delay to trigger abort during the backoff sleep
      setTimeout(() => abortController.abort(), 10);

      await expect(promise).rejects.toThrow(RequestCancelledError);
      // Aborts during attempt 1 backoff without attempting attempt 2
      expect(fakeRegistry.recordedQueries).toHaveLength(1);
    });
  });

  describe('Cancellation Propagation', () => {
    it('aborts execution when parentSignal is cancelled', async () => {
      const abortController = new AbortController();
      fakeGateway.delayMs = 100;

      const promise = useCase.executeUnary(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Long request' }],
        },
        mockContext,
        abortController.signal,
      );

      setTimeout(() => abortController.abort(), 10);

      await expect(promise).rejects.toThrow(RequestCancelledError);
    });
  });

  describe('Streaming Delivery & Reasoning Privacy', () => {
    it('streams events to caller in real time', async () => {
      const stream = useCase.executeStream(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Stream this' }],
          stream: true,
          effort: 'high',
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThanOrEqual(3);
      expect(events.some((e) => e.event === 'token')).toBe(true);
      expect(events.some((e) => e.event === 'finish')).toBe(true);
    });

    it('filters thinking events when exposeReasoning is false', async () => {
      const stream = useCase.executeStream(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Stream this' }],
          stream: true,
          effort: 'high',
          exposeReasoning: false,
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.some((e) => e.event === 'thinking')).toBe(false);
      expect(events.some((e) => e.event === 'token')).toBe(true);
    });

    it('emits terminal error event if stream drops mid-stream (zero mid-stream retry invariant)', async () => {
      fakeGateway.customStreamEvents = [
        { event: 'token', data: { delta: 'Partial chunk' } },
        // Will throw during async iteration
      ];

      // Simulate a failure after first event
      async function* faultyStream() {
        yield { event: 'token' as const, data: { delta: 'Chunk 1' } };
        throw new Error('Connection dropped by upstream provider');
      }

      fakeGateway.dispatchStream = () => faultyStream();

      const stream = useCase.executeStream(
        {
          model: 'claude-sonnet',
          messages: [{ role: 'user', content: 'Stream' }],
          stream: true,
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]?.event).toBe('token');
      expect(events[1]?.event).toBe('error');
    });
  });

  describe('Validation', () => {
    it('throws InvalidRequestError if model or messages are missing', async () => {
      await expect(
        useCase.executeUnary(
          {
            model: '' as unknown as CanonicalModelId,
            messages: [{ role: 'user', content: 'Hi' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(InvalidRequestError);

      await expect(
        useCase.executeUnary(
          {
            model: 'claude-sonnet',
            messages: [],
          },
          mockContext,
        ),
      ).rejects.toThrow(InvalidRequestError);
    });
  });
});
