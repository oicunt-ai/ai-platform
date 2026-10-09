import { beforeEach, describe, expect, it } from 'vitest';
import type { TurnExecutionContext } from '../../src/domain/types.js';
import { CoordinateChatTurnUseCase } from '../../src/application/use-cases/coordinate-chat-turn.use-case.js';
import { InMemoryResolutionCache } from '../../src/infrastructure/cache/in-memory-resolution-cache.js';
import { FakeModelRegistry } from '../test-doubles/fake-model-registry.js';
import { FakeInference } from '../test-doubles/fake-inference.js';
import { FakeMemory } from '../test-doubles/fake-memory.js';
import { InvalidRequestError, OrchestratorError } from '../../src/domain/errors.js';

describe('Application - Memory Service Integration', () => {
  let fakeRegistry: FakeModelRegistry;
  let fakeInference: FakeInference;
  let fakeMemory: FakeMemory;
  let cache: InMemoryResolutionCache;
  let useCase: CoordinateChatTurnUseCase;

  const mockContext: TurnExecutionContext = {
    turnId: 'turn_abc123',
    requestId: 'req_def456',
    correlationId: 'corr_ghi789',
    actorId: 'test-agent',
    serviceName: 'billy-api',
    tenantId: 'ten_enterprise',
    userId: 'usr_charlie',
    startTime: Date.now(),
  };

  beforeEach(() => {
    fakeRegistry = new FakeModelRegistry();
    fakeInference = new FakeInference();
    fakeMemory = new FakeMemory();
    cache = new InMemoryResolutionCache(60);

    useCase = new CoordinateChatTurnUseCase({
      modelRegistry: fakeRegistry,
      inference: fakeInference,
      memory: fakeMemory,
      resolutionCache: cache,
      defaultTimeoutMs: 120_000,
      maxTimeoutMs: 300_000,
    });
  });

  describe('Context Hydration Prior to Inference', () => {
    it('hydrates conversation context from Memory and prefixes it to inference messages', async () => {
      fakeMemory.setConversationMessages('conv_1', [
        { role: 'user', content: 'What is OICUNT?' },
        { role: 'assistant', content: 'OICUNT is an enterprise AI platform.' },
      ]);

      const result = await useCase.executeUnary(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_1',
          messages: [{ role: 'user', content: 'What models does it support?' }],
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(fakeMemory.recordedContextCalls).toHaveLength(1);
      expect(fakeMemory.recordedContextCalls[0]?.conversationId).toBe('conv_1');

      // Check inference received full hydrated history + current turn
      expect(fakeInference.recordedRequests).toHaveLength(1);
      const inferenceMessages = fakeInference.recordedRequests[0]?.messages;
      expect(inferenceMessages).toHaveLength(3);
      expect(inferenceMessages?.[0]?.content).toBe('What is OICUNT?');
      expect(inferenceMessages?.[1]?.content).toBe('OICUNT is an enterprise AI platform.');
      expect(inferenceMessages?.[2]?.content).toBe('What models does it support?');
    });

    it('propagates identity and correlation headers during context hydration', async () => {
      fakeMemory.setConversationMessages('conv_ident', [{ role: 'user', content: 'Hello' }]);

      await useCase.executeUnary(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_ident',
          messages: [{ role: 'user', content: 'How are you?' }],
        },
        mockContext,
      );

      const memCall = fakeMemory.recordedContextCalls[0];
      expect(memCall?.context.correlationId).toBe(mockContext.correlationId);
      expect(memCall?.context.requestId).toBe(mockContext.requestId);
      expect(memCall?.context.tenantId).toBe(mockContext.tenantId);
      expect(memCall?.context.userId).toBe(mockContext.userId);
      expect(memCall?.context.actorId).toBe(mockContext.actorId);
      expect(memCall?.context.turnId).toBe(mockContext.turnId);
      expect(memCall?.context.deadlineMs).toBeDefined();
    });
  });

  describe('Deduplication & Exact-Once User Message Inclusion', () => {
    it('deduplicates when client submits full conversation history along with new message', async () => {
      // Memory already has turn 1
      fakeMemory.setConversationMessages('conv_full_history', [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Reply 1' },
      ]);

      // Client sends full history plus Message 2
      await useCase.executeUnary(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_full_history',
          messages: [
            { role: 'user', content: 'Message 1' },
            { role: 'assistant', content: 'Reply 1' },
            { role: 'user', content: 'Message 2' },
          ],
        },
        mockContext,
      );

      // Inference messages should not repeat Message 1 and Reply 1
      const inferenceMessages = fakeInference.recordedRequests[0]?.messages;
      expect(inferenceMessages).toHaveLength(3);
      expect(inferenceMessages?.[0]?.content).toBe('Message 1');
      expect(inferenceMessages?.[1]?.content).toBe('Reply 1');
      expect(inferenceMessages?.[2]?.content).toBe('Message 2');

      // Only the new user message (Message 2) and assistant reply should be checkpointed
      expect(fakeMemory.recordedCheckpoints).toHaveLength(1);
      const checkpointedMessages = fakeMemory.recordedCheckpoints[0]?.request.messages;
      expect(checkpointedMessages).toHaveLength(2);
      expect(checkpointedMessages?.[0]?.content).toBe('Message 2');
      expect(checkpointedMessages?.[1]?.role).toBe('assistant');
    });

    it('does not duplicate user message if it is already present in hydrated context', async () => {
      // Memory already has the user turn
      fakeMemory.setConversationMessages('conv_already_saved', [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Reply 1' },
        { role: 'user', content: 'Current Question' },
      ]);

      // Client passes the same current turn
      await useCase.executeUnary(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_already_saved',
          messages: [{ role: 'user', content: 'Current Question' }],
        },
        mockContext,
      );

      const inferenceMessages = fakeInference.recordedRequests[0]?.messages;
      expect(inferenceMessages).toHaveLength(3);
      expect(inferenceMessages?.[0]?.content).toBe('Message 1');
      expect(inferenceMessages?.[1]?.content).toBe('Reply 1');
      expect(inferenceMessages?.[2]?.content).toBe('Current Question');

      // Only the assistant reply should be checkpointed, NOT a duplicate user message
      expect(fakeMemory.recordedCheckpoints).toHaveLength(1);
      const checkpointed = fakeMemory.recordedCheckpoints[0]?.request.messages;
      expect(checkpointed).toHaveLength(1);
      expect(checkpointed?.[0]?.role).toBe('assistant');
    });
  });

  describe('Post-Inference Turn Checkpointing (Unary)', () => {
    it('checkpoints user turn and assistant completion to Memory with turnId and identity metadata', async () => {
      fakeMemory.setConversationMessages('conv_unary', []);

      const result = await useCase.executeUnary(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_unary',
          messages: [{ role: 'user', content: 'What is the speed of light?' }],
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(fakeMemory.recordedCheckpoints).toHaveLength(1);

      const checkpoint = fakeMemory.recordedCheckpoints[0];
      expect(checkpoint?.request.conversationId).toBe('conv_unary');
      expect(checkpoint?.request.turnId).toBe(mockContext.turnId);
      expect(checkpoint?.request.messages).toHaveLength(2);

      // User message
      expect(checkpoint?.request.messages[0]?.role).toBe('user');
      expect(checkpoint?.request.messages[0]?.content).toBe('What is the speed of light?');
      expect(checkpoint?.request.messages[0]?.metadata?.['turnId']).toBe(mockContext.turnId);
      expect(checkpoint?.request.messages[0]?.metadata?.['requestId']).toBe(mockContext.requestId);

      // Assistant message
      expect(checkpoint?.request.messages[1]?.role).toBe('assistant');
      expect(checkpoint?.request.messages[1]?.metadata?.['turnId']).toBe(mockContext.turnId);
      expect(checkpoint?.request.messages[1]?.metadata?.['requestId']).toBe(mockContext.requestId);
      expect(checkpoint?.request.messages[1]?.metadata?.['completionId']).toBeDefined();

      // Memory call context identity propagation
      expect(checkpoint?.context.turnId).toBe(mockContext.turnId);
      expect(checkpoint?.context.correlationId).toBe(mockContext.correlationId);
      expect(checkpoint?.context.requestId).toBe(mockContext.requestId);
      expect(checkpoint?.context.tenantId).toBe(mockContext.tenantId);
    });
  });

  describe('Post-Inference Turn Checkpointing (Streaming)', () => {
    it('checkpoints turn upon successful finish event and ensures checkpoint occurs BEFORE finish event is exposed', async () => {
      fakeMemory.setConversationMessages('conv_stream', [
        { role: 'user', content: 'Earlier message' },
        { role: 'assistant', content: 'Earlier reply' },
      ]);

      const lifecycleLog: string[] = [];
      const originalCheckpoint = fakeMemory.checkpointTurn.bind(fakeMemory);
      fakeMemory.checkpointTurn = async (req, ctx, sig) => {
        lifecycleLog.push('memory_checkpoint');
        return originalCheckpoint(req, ctx, sig);
      };

      const stream = useCase.executeStream(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_stream',
          messages: [{ role: 'user', content: 'Stream some text' }],
          stream: true,
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        lifecycleLog.push(`client_received_${event.event}`);
        events.push(event);
      }

      // Prove that memory_checkpoint occurred strictly BEFORE client_received_finish
      const checkpointIndex = lifecycleLog.indexOf('memory_checkpoint');
      const finishIndex = lifecycleLog.indexOf('client_received_finish');
      expect(checkpointIndex).toBeGreaterThan(-1);
      expect(finishIndex).toBeGreaterThan(checkpointIndex);

      expect(events.some((e) => e.event === 'finish')).toBe(true);
      expect(fakeMemory.recordedCheckpoints).toHaveLength(1);

      const checkpoint = fakeMemory.recordedCheckpoints[0];
      expect(checkpoint?.request.conversationId).toBe('conv_stream');
      expect(checkpoint?.request.turnId).toBe(mockContext.turnId);
      expect(checkpoint?.request.messages).toHaveLength(2);
      expect(checkpoint?.request.messages[0]?.role).toBe('user');
      expect(checkpoint?.request.messages[1]?.content).toEqual([
        { type: 'thinking', thinking: 'Deep thought step 1.' },
        { type: 'text', text: 'Hello world!' },
      ]);
    });

    it('does NOT emit terminal finish event and surfaces error event when Memory checkpoint fails', async () => {
      fakeMemory.setConversationMessages('conv_stream_chkpt_fail', []);
      fakeMemory.shouldFailCheckpointWith = new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'Database connection lost during turn checkpoint',
        503,
        true,
        undefined,
        undefined,
        mockContext.correlationId,
      );

      const stream = useCase.executeStream(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_stream_chkpt_fail',
          messages: [{ role: 'user', content: 'Stream with checkpoint failure' }],
          stream: true,
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      // Client must receive token chunks, but NEVER a finish event
      expect(events.some((e) => e.event === 'token')).toBe(true);
      expect(events.some((e) => e.event === 'finish')).toBe(false);

      // Terminal error event must be surfaced
      const errorEvent = events.find((e) => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.data.message).toBe('Database connection lost during turn checkpoint');
      expect(fakeMemory.recordedCheckpoints).toHaveLength(1);
    });

    it('does NOT checkpoint if stream completes with finishReason cancelled', async () => {
      fakeMemory.setConversationMessages('conv_stream_cancelled_finish', []);

      async function* cancelledFinishStream() {
        yield { event: 'token' as const, data: { delta: 'Partial chunk' } };
        yield {
          event: 'finish' as const,
          data: {
            finishReason: 'cancelled' as const,
            usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
          },
        };
      }

      fakeInference.executeStream = () => cancelledFinishStream();

      const stream = useCase.executeStream(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_stream_cancelled_finish',
          messages: [{ role: 'user', content: 'Stream cancelled' }],
          stream: true,
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.some((e) => e.event === 'finish')).toBe(true);
      expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
    });

    it('checkpoints plain text assistant message when exposeReasoning is false', async () => {
      fakeMemory.setConversationMessages('conv_stream_no_reasoning', []);

      const stream = useCase.executeStream(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_stream_no_reasoning',
          messages: [{ role: 'user', content: 'Stream without reasoning' }],
          stream: true,
          exposeReasoning: false,
        },
        mockContext,
      );

      for await (const _event of stream) {
        // drain
      }

      expect(fakeMemory.recordedCheckpoints).toHaveLength(1);
      const checkpoint = fakeMemory.recordedCheckpoints[0];
      expect(checkpoint?.request.messages[1]?.role).toBe('assistant');
      expect(checkpoint?.request.messages[1]?.content).toBe('Hello world!');
    });

    it('does NOT checkpoint if stream is aborted or cancelled by caller', async () => {
      fakeMemory.setConversationMessages('conv_stream_abort', []);

      const parentController = new AbortController();

      // Configure fake inference with custom slow generator
      async function* slowStream() {
        yield { event: 'token' as const, data: { delta: 'Partial' } };
        // Trigger abort before finish
        parentController.abort();
        yield { event: 'token' as const, data: { delta: ' words' } };
      }

      fakeInference.executeStream = () => slowStream();

      const stream = useCase.executeStream(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_stream_abort',
          messages: [{ role: 'user', content: 'Will be cancelled' }],
          stream: true,
        },
        mockContext,
        parentController.signal,
      );

      const events = [];
      try {
        for await (const event of stream) {
          events.push(event);
        }
      } catch {
        // Stream aborted
      }

      // Must NEVER checkpoint cancelled or incomplete stream
      expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
    });

    it('does NOT checkpoint if stream encounters mid-stream error', async () => {
      fakeMemory.setConversationMessages('conv_stream_err', []);

      async function* faultyStream() {
        yield { event: 'token' as const, data: { delta: 'Partial chunk' } };
        throw new Error('Connection closed prematurely by remote host');
      }

      fakeInference.executeStream = () => faultyStream();

      const stream = useCase.executeStream(
        {
          model: 'oicunt.model.catalog-alpha',
          conversationId: 'conv_stream_err',
          messages: [{ role: 'user', content: 'Error stream' }],
          stream: true,
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.some((e) => e.event === 'error')).toBe(true);
      // Zero checkpointing on errored stream
      expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
    });
  });

  describe('Stateless Behavior Preserved Without conversationId', () => {
    it('executes purely statelessly when conversationId is absent in unary request', async () => {
      const result = await useCase.executeUnary(
        {
          model: 'oicunt.model.catalog-alpha',
          messages: [{ role: 'user', content: 'No conversation ID' }],
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(fakeMemory.recordedContextCalls).toHaveLength(0);
      expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
      expect(fakeInference.recordedRequests).toHaveLength(1);
      expect(fakeInference.recordedRequests[0]?.messages).toHaveLength(1);
    });

    it('executes purely statelessly when conversationId is absent in streaming request', async () => {
      const stream = useCase.executeStream(
        {
          model: 'oicunt.model.catalog-alpha',
          messages: [{ role: 'user', content: 'No conversation ID stream' }],
          stream: true,
        },
        mockContext,
      );

      const events = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(fakeMemory.recordedContextCalls).toHaveLength(0);
      expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
    });
  });

  describe('Clean Error Propagation & No Silent Fallback', () => {
    it('fails cleanly without silent fallback when Memory context hydration fails', async () => {
      fakeMemory.shouldFailGetContextWith = new InvalidRequestError(
        'Conversation has been deleted or archived',
        mockContext.correlationId,
      );

      await expect(
        useCase.executeUnary(
          {
            model: 'oicunt.model.catalog-alpha',
            conversationId: 'conv_deleted',
            messages: [{ role: 'user', content: 'Should fail' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(InvalidRequestError);

      // Model inference must NOT be called if Memory context fails!
      expect(fakeInference.recordedRequests).toHaveLength(0);
      expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
    });

    it('fails cleanly when conversationId is provided but MemoryPort is not configured', async () => {
      const statelessUseCase = new CoordinateChatTurnUseCase({
        modelRegistry: fakeRegistry,
        inference: fakeInference,
        // memory omitted
      });

      await expect(
        statelessUseCase.executeUnary(
          {
            model: 'oicunt.model.catalog-alpha',
            conversationId: 'conv_unconfigured',
            messages: [{ role: 'user', content: 'Should fail' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(OrchestratorError);

      expect(fakeInference.recordedRequests).toHaveLength(0);
    });

    it('surfaces Memory checkpoint failure cleanly without blind retry', async () => {
      fakeMemory.shouldFailCheckpointWith = new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'Database connection lost during write',
        503,
        true,
        undefined,
        undefined,
        mockContext.correlationId,
      );

      await expect(
        useCase.executeUnary(
          {
            model: 'oicunt.model.catalog-alpha',
            conversationId: 'conv_write_fail',
            messages: [{ role: 'user', content: 'Fails on write' }],
          },
          mockContext,
        ),
      ).rejects.toThrow(OrchestratorError);

      // Attempted write once, did not blind retry
      expect(fakeMemory.recordedCheckpoints).toHaveLength(1);
    });
  });
});
