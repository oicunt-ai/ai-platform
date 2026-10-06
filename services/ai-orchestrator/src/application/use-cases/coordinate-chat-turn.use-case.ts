import type { AiMetricsRecorder, AiTracer } from '@oicunt-ai/observability';
import { NoopAiMetricsRecorder, NoopAiTracer } from '@oicunt-ai/observability';
import type { ChatMessage, MessageContentPart, StreamEvent } from '@oicunt-ai/ai-types';
import type { ReasoningEffortLevel } from '@oicunt-ai/model-types';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  InferenceTimeoutError,
  InvalidRequestError,
  ModelDeprecatedError,
  ModelInMaintenanceError,
  ModelNotFoundError,
  OrchestratorError,
  RegistryUnavailableError,
  RequestCancelledError,
  UnsupportedEffortLevelError,
} from '../../domain/errors.js';
import { ContextWindowEstimator } from '../../domain/context-window-estimator.js';
import { calculateTurnCost } from '../../domain/cost-calculator.js';
import type { ReasoningPrivacyPolicy, TurnExecutionContext } from '../../domain/types.js';
import type {
  OrchestratorChatData,
  OrchestratorChatRequest,
  OrchestratorChatResponse,
} from '../dtos/chat.dto.js';
import type { InferenceExecutionRequest } from '../dtos/inference.dto.js';
import type { ModelResolutionResult } from '../dtos/resolution.dto.js';
import type { InferencePort } from '../ports/inference.port.js';
import type { ModelRegistryPort } from '../ports/model-registry.port.js';
import type { ResolutionCachePort } from '../ports/resolution-cache.port.js';
import type { CheckpointMessageItem, MemoryCallContext, MemoryPort } from '../ports/memory.port.js';

export interface CoordinateChatTurnOptions {
  readonly modelRegistry: ModelRegistryPort;
  readonly inference: InferencePort;
  readonly memory?: MemoryPort | undefined;
  readonly resolutionCache?: ResolutionCachePort | undefined;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
  readonly defaultTimeoutMs?: number | undefined;
  readonly maxTimeoutMs?: number | undefined;
  readonly cacheTtlSeconds?: number | undefined;
  readonly privacyPolicy?: ReasoningPrivacyPolicy | undefined;
}

export class CoordinateChatTurnUseCase {
  private readonly modelRegistry: ModelRegistryPort;
  private readonly inference: InferencePort;
  private readonly memory?: MemoryPort | undefined;
  private readonly resolutionCache?: ResolutionCachePort | undefined;
  private readonly tracer: AiTracer;
  private readonly metrics: AiMetricsRecorder;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly cacheTtlSeconds: number;
  private readonly privacyPolicy: ReasoningPrivacyPolicy;

  constructor(options: CoordinateChatTurnOptions) {
    this.modelRegistry = options.modelRegistry;
    this.inference = options.inference;
    this.memory = options.memory;
    this.resolutionCache = options.resolutionCache;
    this.tracer = options.tracer ?? new NoopAiTracer();
    this.metrics = options.metrics ?? new NoopAiMetricsRecorder();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;
    this.maxTimeoutMs = options.maxTimeoutMs ?? 300_000;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 45;
    this.privacyPolicy = options.privacyPolicy ?? {
      exposeReasoning: true,
      redactThinkingInLogs: true,
    };
  }

  /**
   * Coordinates a complete unary chat turn: validates, resolves, bounds context,
   * dispatches to Inference Service, and returns the response.
   */
  public async executeUnary(
    request: OrchestratorChatRequest,
    context: TurnExecutionContext,
    parentSignal?: AbortSignal,
  ): Promise<OrchestratorChatResponse> {
    const startTime = Date.now();
    this.validateRequest(request, context.correlationId);

    const { deadlineMs, timeoutMs } = this.calculateBudget(request.timeoutMs);

    // Create an abort controller combining parentSignal and deadline
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new InferenceTimeoutError(timeoutMs, context.correlationId));
    }, timeoutMs);

    const onParentAbort = (): void => {
      abortController.abort(
        parentSignal?.reason ??
          new RequestCancelledError(
            'Inference request was cancelled by the caller.',
            context.correlationId,
          ),
      );
    };

    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timeoutHandle);
        throw parentSignal.reason instanceof Error
          ? parentSignal.reason
          : new RequestCancelledError(
              'Inference request was cancelled by the caller.',
              context.correlationId,
            );
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const span = this.tracer.startSpan('orchestrator.chat_turn', {
      'gen_ai.request.model': request.model,
      'oicunt.canonical_model': request.model,
      'oicunt.conversation_id': request.conversationId ?? '',
      'oicunt.turn_id': context.turnId,
      'oicunt.correlation_id': context.correlationId,
      'oicunt.stream': false,
    });

    try {
      // 1. Hydrate conversation context from Memory if conversationId is present
      let effectiveMessages = request.messages;
      let newTurnMessagesToSave: readonly ChatMessage[] = [];

      if (request.conversationId) {
        if (!this.memory) {
          throw new OrchestratorError(
            'INTERNAL_ORCHESTRATOR_ERROR',
            'Memory Service port is not configured for conversation execution.',
            500,
            false,
            undefined,
            undefined,
            context.correlationId,
          );
        }

        const memoryContext: MemoryCallContext = {
          tenantId: context.tenantId,
          userId: context.userId,
          actorId: context.actorId,
          correlationId: context.correlationId,
          requestId: context.requestId,
          turnId: context.turnId,
          deadlineMs,
        };

        const hydrated = await this.memory.getContext(
          request.conversationId,
          {},
          memoryContext,
          abortController.signal,
        );

        const { combinedMessages, newTurnMessages } = this.combineContextMessages(
          hydrated.messages,
          request.messages,
        );

        effectiveMessages = combinedMessages;
        newTurnMessagesToSave = newTurnMessages;
      }

      const harmonizedMessages = this.harmonizeMessages(effectiveMessages, request.systemPrompt);

      // 2. Resolve model via Registry / L1 cache
      const resolution = await this.resolveModelWithCache(request, context, abortController.signal);

      // 3. Validate reasoning effort
      const effectiveEffort = this.determineEffort(
        request.effort,
        resolution,
        context.correlationId,
      );

      // 4. Preflight context window check
      this.validateContextWindow(
        harmonizedMessages,
        resolution,
        request.parameters?.maxTokens,
        context.correlationId,
      );

      // 5. Construct inference execution request
      const exposeReasoning = request.exposeReasoning ?? this.privacyPolicy.exposeReasoning;

      const inferenceRequest: InferenceExecutionRequest = {
        requestId: context.requestId,
        correlationId: context.correlationId,
        conversationId: request.conversationId,
        canonicalModelId: resolution.canonicalModelId,
        version: resolution.version,
        messages: harmonizedMessages,
        parameters: request.parameters,
        effort: effectiveEffort,
        tools: request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        stream: false,
        limits: resolution.limits,
        pricing: resolution.pricing,
        eligibleTargets: resolution.eligibleTargets,
        routingPolicy: resolution.routingPolicy,
        privacyPolicy: {
          exposeReasoning,
          redactThinking: !exposeReasoning,
          redactThinkingInLogs: true,
        },
        tenantId: context.tenantId,
        userId: context.userId,
        actorId: context.actorId,
        metadata: request.metadata,
        deadlineMs,
      };

      // 6. Execute unary through Inference Service
      const response = await this.inference.executeUnary(inferenceRequest, abortController.signal);
      const completion = response.data;

      const turnLatencyMs = Date.now() - startTime;
      const estimatedCostUsd = calculateTurnCost(resolution.pricing, completion.usage);

      // Sanitize thinking in assistant message if privacy restricts it
      let finalMessage = completion.message;
      if (!exposeReasoning && Array.isArray(finalMessage.content)) {
        const filteredParts = finalMessage.content.filter((part) => part.type !== 'thinking');
        finalMessage = { ...finalMessage, content: filteredParts };
      }

      // 7. Checkpoint completed user turn and assistant response to Memory
      if (
        request.conversationId &&
        this.memory &&
        !abortController.signal.aborted &&
        completion.finishReason !== 'error' &&
        completion.finishReason !== 'cancelled'
      ) {
        const memoryContext: MemoryCallContext = {
          tenantId: context.tenantId,
          userId: context.userId,
          actorId: context.actorId,
          correlationId: context.correlationId,
          requestId: context.requestId,
          turnId: context.turnId,
          deadlineMs,
        };

        const messagesToCheckpoint: CheckpointMessageItem[] = [
          ...newTurnMessagesToSave.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.name ? { name: m.name } : {}),
            metadata: {
              ...(m.metadata ?? {}),
              requestId: context.requestId,
              turnId: context.turnId,
            },
          })),
          {
            role: 'assistant',
            content: finalMessage.content,
            ...(finalMessage.name ? { name: finalMessage.name } : {}),
            metadata: {
              ...(finalMessage.metadata ?? {}),
              requestId: context.requestId,
              turnId: context.turnId,
              completionId: completion.completionId,
            },
          },
        ];

        await this.memory.checkpointTurn(
          {
            conversationId: request.conversationId,
            turnId: context.turnId,
            messages: messagesToCheckpoint,
          },
          memoryContext,
          abortController.signal,
        );
      }

      const chatData: OrchestratorChatData = {
        message: finalMessage,
        finishReason: completion.finishReason,
        usage: completion.usage,
        model: resolution.canonicalModelId,
        version: resolution.version,
        effort: effectiveEffort,
        completionId: completion.completionId,
        conversationId: request.conversationId,
        turnLatencyMs,
        estimatedCostUsd,
      };

      // Record metrics & span attributes
      this.metrics.recordInferenceDuration(resolution.canonicalModelId, turnLatencyMs, {
        status: 'success',
        stream: 'false',
      });
      this.metrics.recordTokenUsage(resolution.canonicalModelId, completion.usage, {
        stream: 'false',
      });
      if (estimatedCostUsd !== undefined) {
        this.metrics.recordEstimatedCost(resolution.canonicalModelId, estimatedCostUsd, {
          tenantId: context.tenantId ?? 'default',
        });
      }

      span.setAttribute('gen_ai.response.model', resolution.canonicalModelId);
      span.setAttribute('gen_ai.usage.prompt_tokens', completion.usage.promptTokens);
      span.setAttribute('gen_ai.usage.completion_tokens', completion.usage.completionTokens);
      span.setAttribute('gen_ai.usage.total_tokens', completion.usage.totalTokens);
      span.setAttribute('oicunt.estimated_cost_usd', estimatedCostUsd ?? 0);
      span.setStatus('ok');
      span.end();

      return {
        success: true,
        data: chatData,
        meta: {
          requestId: context.requestId,
          correlationId: context.correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      const normalizedError = this.normalizeError(
        err,
        abortController.signal,
        context.correlationId,
      );
      span.setStatus('error', normalizedError.message);
      span.setAttribute('error.code', normalizedError.code);
      span.end();

      throw normalizedError;
    } finally {
      clearTimeout(timeoutHandle);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  /**
   * Coordinates a streaming chat turn: validates, resolves, bounds context,
   * dispatches to Inference Service, and yields an AsyncIterable of Server-Sent Events.
   */
  public async *executeStream(
    request: OrchestratorChatRequest,
    context: TurnExecutionContext,
    parentSignal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const startTime = Date.now();
    this.validateRequest(request, context.correlationId);

    const { deadlineMs, timeoutMs } = this.calculateBudget(request.timeoutMs);

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort(new InferenceTimeoutError(timeoutMs, context.correlationId));
    }, timeoutMs);

    const onParentAbort = (): void => {
      abortController.abort(
        parentSignal?.reason ??
          new RequestCancelledError(
            'Inference request was cancelled by the caller.',
            context.correlationId,
          ),
      );
    };

    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timeoutHandle);
        throw parentSignal.reason instanceof Error
          ? parentSignal.reason
          : new RequestCancelledError(
              'Inference request was cancelled by the caller.',
              context.correlationId,
            );
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const span = this.tracer.startSpan('orchestrator.chat_turn', {
      'gen_ai.request.model': request.model,
      'oicunt.canonical_model': request.model,
      'oicunt.conversation_id': request.conversationId ?? '',
      'oicunt.turn_id': context.turnId,
      'oicunt.correlation_id': context.correlationId,
      'oicunt.stream': true,
    });

    let emittedFirstEvent = false;

    try {
      // 1. Hydrate conversation context from Memory if conversationId is present
      let effectiveMessages = request.messages;
      let newTurnMessagesToSave: readonly ChatMessage[] = [];

      if (request.conversationId) {
        if (!this.memory) {
          throw new OrchestratorError(
            'INTERNAL_ORCHESTRATOR_ERROR',
            'Memory Service port is not configured for conversation execution.',
            500,
            false,
            undefined,
            undefined,
            context.correlationId,
          );
        }

        const memoryContext: MemoryCallContext = {
          tenantId: context.tenantId,
          userId: context.userId,
          actorId: context.actorId,
          correlationId: context.correlationId,
          requestId: context.requestId,
          turnId: context.turnId,
          deadlineMs,
        };

        const hydrated = await this.memory.getContext(
          request.conversationId,
          {},
          memoryContext,
          abortController.signal,
        );

        const { combinedMessages, newTurnMessages } = this.combineContextMessages(
          hydrated.messages,
          request.messages,
        );

        effectiveMessages = combinedMessages;
        newTurnMessagesToSave = newTurnMessages;
      }

      const harmonizedMessages = this.harmonizeMessages(effectiveMessages, request.systemPrompt);

      // 2. Resolve model via Registry / L1 cache
      const resolution = await this.resolveModelWithCache(request, context, abortController.signal);

      // 3. Validate reasoning effort
      const effectiveEffort = this.determineEffort(
        request.effort,
        resolution,
        context.correlationId,
      );

      // 4. Preflight context window check
      this.validateContextWindow(
        harmonizedMessages,
        resolution,
        request.parameters?.maxTokens,
        context.correlationId,
      );

      // 5. Construct inference execution request
      const exposeReasoning = request.exposeReasoning ?? this.privacyPolicy.exposeReasoning;

      const inferenceRequest: InferenceExecutionRequest = {
        requestId: context.requestId,
        correlationId: context.correlationId,
        conversationId: request.conversationId,
        canonicalModelId: resolution.canonicalModelId,
        version: resolution.version,
        messages: harmonizedMessages,
        parameters: request.parameters,
        effort: effectiveEffort,
        tools: request.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
        stream: true,
        limits: resolution.limits,
        pricing: resolution.pricing,
        eligibleTargets: resolution.eligibleTargets,
        routingPolicy: resolution.routingPolicy,
        privacyPolicy: {
          exposeReasoning,
          redactThinking: !exposeReasoning,
          redactThinkingInLogs: true,
        },
        tenantId: context.tenantId,
        userId: context.userId,
        actorId: context.actorId,
        metadata: request.metadata,
        deadlineMs,
      };

      // 6. Execute stream through Inference Service
      const stream = this.inference.executeStream(inferenceRequest, abortController.signal);

      let accumulatedText = '';
      let accumulatedThinking = '';
      let pendingFinishEvent: (StreamEvent & { event: 'finish' }) | null = null;

      for await (const event of stream) {
        if (event.event === 'token') {
          accumulatedText += event.data.delta;
          emittedFirstEvent = true;
          yield event;
        } else if (event.event === 'thinking') {
          accumulatedThinking += event.data.delta;
          if (!exposeReasoning) {
            // Drop thinking event if policy suppresses it
            continue;
          }
          emittedFirstEvent = true;
          yield event;
        } else if (event.event === 'finish') {
          pendingFinishEvent = event;

          const turnLatencyMs = Date.now() - startTime;
          const estimatedCostUsd = calculateTurnCost(resolution.pricing, event.data.usage);

          this.metrics.recordInferenceDuration(resolution.canonicalModelId, turnLatencyMs, {
            status: 'success',
            stream: 'true',
          });
          this.metrics.recordTokenUsage(resolution.canonicalModelId, event.data.usage, {
            stream: 'true',
          });
          if (estimatedCostUsd !== undefined) {
            this.metrics.recordEstimatedCost(resolution.canonicalModelId, estimatedCostUsd, {
              tenantId: context.tenantId ?? 'default',
            });
          }

          span.setAttribute('gen_ai.response.model', resolution.canonicalModelId);
          span.setAttribute('gen_ai.usage.prompt_tokens', event.data.usage.promptTokens);
          span.setAttribute('gen_ai.usage.completion_tokens', event.data.usage.completionTokens);
          span.setAttribute('gen_ai.usage.total_tokens', event.data.usage.totalTokens);
          span.setAttribute('oicunt.estimated_cost_usd', estimatedCostUsd ?? 0);
          span.setStatus('ok');
          span.end();
          // Defer yielding finish until Memory checkpoint succeeds
        } else {
          emittedFirstEvent = true;
          yield event;
        }
      }

      // 7. Checkpoint completed streaming turn to Memory BEFORE emitting terminal finish event
      if (pendingFinishEvent) {
        const finishReason = pendingFinishEvent.data.finishReason;

        if (
          request.conversationId &&
          this.memory &&
          finishReason !== 'error' &&
          finishReason !== 'cancelled' &&
          !abortController.signal.aborted
        ) {
          const memoryContext: MemoryCallContext = {
            tenantId: context.tenantId,
            userId: context.userId,
            actorId: context.actorId,
            correlationId: context.correlationId,
            requestId: context.requestId,
            turnId: context.turnId,
            deadlineMs,
          };

          const assistantContent: string | readonly MessageContentPart[] =
            accumulatedThinking.length > 0 && exposeReasoning
              ? [
                  { type: 'thinking', thinking: accumulatedThinking },
                  { type: 'text', text: accumulatedText },
                ]
              : accumulatedText;

          const messagesToCheckpoint: CheckpointMessageItem[] = [
            ...newTurnMessagesToSave.map((m) => ({
              role: m.role,
              content: m.content,
              ...(m.name ? { name: m.name } : {}),
              metadata: {
                ...(m.metadata ?? {}),
                requestId: context.requestId,
                turnId: context.turnId,
              },
            })),
            {
              role: 'assistant',
              content: assistantContent,
              metadata: {
                requestId: context.requestId,
                turnId: context.turnId,
                finishReason,
              },
            },
          ];

          await this.memory.checkpointTurn(
            {
              conversationId: request.conversationId,
              turnId: context.turnId,
              messages: messagesToCheckpoint,
            },
            memoryContext,
            abortController.signal,
          );
        }

        // Only after Memory checkpoint succeeds (or if stateless), emit terminal finish event
        emittedFirstEvent = true;
        yield pendingFinishEvent;
      }
    } catch (err: unknown) {
      const normalizedError = this.normalizeError(
        err,
        abortController.signal,
        context.correlationId,
      );
      span.setStatus('error', normalizedError.message);
      span.setAttribute('error.code', normalizedError.code);
      span.end();

      if (emittedFirstEvent) {
        // Zero mid-stream retries invariant: emit terminal error event
        yield {
          event: 'error',
          data: {
            code: normalizedError.code,
            message: normalizedError.message,
          },
        };
      } else {
        // Stream hasn't emitted chunks yet; propagate error so HTTP layer can return JSON error
        throw normalizedError;
      }
    } finally {
      clearTimeout(timeoutHandle);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  // --- Private Helpers ---

  private validateRequest(request: OrchestratorChatRequest, correlationId: string): void {
    if (!request.model || typeof request.model !== 'string' || request.model.trim() === '') {
      throw new InvalidRequestError('Canonical model identifier is required', correlationId);
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new InvalidRequestError('At least one chat message is required', correlationId);
    }
    for (const msg of request.messages) {
      if (!msg.role || !['system', 'user', 'assistant', 'tool'].includes(msg.role)) {
        throw new InvalidRequestError(`Invalid message role: '${String(msg.role)}'`, correlationId);
      }
      if (msg.content === undefined || msg.content === null) {
        throw new InvalidRequestError('Message content cannot be null or undefined', correlationId);
      }
    }
  }

  private combineContextMessages(
    history: readonly ChatMessage[],
    incoming: readonly ChatMessage[],
  ): {
    readonly combinedMessages: readonly ChatMessage[];
    readonly newTurnMessages: readonly ChatMessage[];
  } {
    const systemMessages = incoming.filter((m) => m.role === 'system');
    const nonSystemIncoming = incoming.filter((m) => m.role !== 'system');

    if (history.length === 0) {
      return {
        combinedMessages: incoming,
        newTurnMessages: nonSystemIncoming,
      };
    }

    if (nonSystemIncoming.length === 0) {
      return {
        combinedMessages: [...systemMessages, ...history],
        newTurnMessages: [],
      };
    }

    const maxOverlap = Math.min(history.length, nonSystemIncoming.length);
    let matchedOverlap = 0;

    for (let overlap = maxOverlap; overlap >= 1; overlap--) {
      let matches = true;
      for (let i = 0; i < overlap; i++) {
        const histMsg = history[history.length - overlap + i];
        const incMsg = nonSystemIncoming[i];
        if (!histMsg || !incMsg || !this.areMessagesEqual(histMsg, incMsg)) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchedOverlap = overlap;
        break;
      }
    }

    const newTurnMessages = nonSystemIncoming.slice(matchedOverlap);
    const combinedMessages = [...systemMessages, ...history, ...newTurnMessages];

    return {
      combinedMessages,
      newTurnMessages,
    };
  }

  private areMessagesEqual(a: ChatMessage, b: ChatMessage): boolean {
    if (a.role !== b.role) {
      return false;
    }
    if (a.name !== b.name) {
      return false;
    }
    if (typeof a.content === 'string' && typeof b.content === 'string') {
      return a.content === b.content;
    }
    try {
      return JSON.stringify(a.content) === JSON.stringify(b.content);
    } catch {
      return false;
    }
  }

  private harmonizeMessages(
    messages: readonly ChatMessage[],
    systemPrompt?: string,
  ): readonly ChatMessage[] {
    if (!systemPrompt || systemPrompt.trim() === '') {
      return messages;
    }

    const trimmedPrompt = systemPrompt.trim();
    if (messages.length === 0) {
      return [{ role: 'system', content: trimmedPrompt }];
    }

    const firstMessage = messages[0];
    if (firstMessage && firstMessage.role === 'system') {
      let combinedContent: string | readonly MessageContentPart[];
      if (typeof firstMessage.content === 'string') {
        combinedContent = `${firstMessage.content}\n\n${trimmedPrompt}`;
      } else if (Array.isArray(firstMessage.content)) {
        combinedContent = [...firstMessage.content, { type: 'text', text: `\n\n${trimmedPrompt}` }];
      } else {
        combinedContent = trimmedPrompt;
      }

      return [
        {
          ...firstMessage,
          content: combinedContent,
        },
        ...messages.slice(1),
      ];
    }

    return [{ role: 'system', content: trimmedPrompt }, ...messages];
  }

  private async resolveModelWithCache(
    request: OrchestratorChatRequest,
    context: TurnExecutionContext,
    signal?: AbortSignal,
  ): Promise<ModelResolutionResult> {
    const cacheKey = `${request.model}:${request.effort ?? 'none'}:${context.tenantId ?? 'global'}`;

    if (this.resolutionCache && !context.bypassCache) {
      try {
        const cached = await this.resolutionCache.get(cacheKey);
        if (cached) {
          this.validateModelStatus(cached, context.correlationId);
          return cached;
        }
      } catch {
        // Cache read errors should not block execution
      }
    }

    // Call Registry with short retry for transient network glitches (up to 2 retries)
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new RequestCancelledError(
              'Inference request was cancelled by the caller.',
              context.correlationId,
            );
      }

      try {
        const result = await this.modelRegistry.resolveModel(
          {
            canonicalModelId: request.model,
            effort: request.effort,
            tenantId: context.tenantId,
            correlationId: context.correlationId,
          },
          signal,
        );

        this.validateModelStatus(result, context.correlationId);

        if (this.resolutionCache) {
          try {
            await this.resolutionCache.set(cacheKey, result, this.cacheTtlSeconds);
          } catch {
            // Ignore cache write failures
          }
        }

        return result;
      } catch (err: unknown) {
        lastError = err;
        if (
          err instanceof InvalidRequestError ||
          err instanceof ModelNotFoundError ||
          err instanceof UnsupportedEffortLevelError ||
          err instanceof ModelInMaintenanceError ||
          err instanceof ModelDeprecatedError ||
          err instanceof RequestCancelledError
        ) {
          // Non-retryable resolution errors
          throw err;
        }

        if (attempt < 3) {
          const backoffMs = attempt * 50;
          await this.sleep(backoffMs, signal, context.correlationId);
        }
      }
    }

    if (lastError instanceof OrchestratorError) {
      throw lastError;
    }
    throw new RegistryUnavailableError(
      lastError instanceof Error ? lastError.message : String(lastError),
      context.correlationId,
    );
  }

  private async sleep(ms: number, signal?: AbortSignal, correlationId = ''): Promise<void> {
    if (ms <= 0) return;
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new RequestCancelledError(
            'Inference request was cancelled by the caller.',
            correlationId,
          );
    }
    return new Promise<void>((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;
      const onAbort = (): void => {
        cleanup();
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new RequestCancelledError(
                'Inference request was cancelled by the caller.',
                correlationId,
              ),
        );
      };
      const cleanup = (): void => {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      timeoutHandle = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private validateModelStatus(result: ModelResolutionResult, correlationId: string): void {
    if (result.status === 'maintenance') {
      throw new ModelInMaintenanceError(result.canonicalModelId, correlationId);
    }
    if (result.status === 'deprecated') {
      throw new ModelDeprecatedError(result.canonicalModelId, correlationId);
    }
    if (!result.eligibleTargets || result.eligibleTargets.length === 0) {
      throw new AllTargetsExhaustedError(
        `No eligible provider targets available for model '${result.canonicalModelId}'`,
        correlationId,
      );
    }
  }

  private determineEffort(
    requestedEffort: ReasoningEffortLevel | undefined,
    resolution: ModelResolutionResult,
    correlationId: string,
  ): ReasoningEffortLevel | undefined {
    const supportsReasoning = Boolean(resolution.capabilities.reasoning);
    const supportedLevels = resolution.capabilities.supportedEffortLevels ?? [];

    if (requestedEffort !== undefined) {
      if (!supportsReasoning) {
        throw new UnsupportedEffortLevelError(
          resolution.canonicalModelId,
          requestedEffort,
          supportedLevels,
          correlationId,
        );
      }
      if (supportedLevels.length > 0 && !supportedLevels.includes(requestedEffort)) {
        throw new UnsupportedEffortLevelError(
          resolution.canonicalModelId,
          requestedEffort,
          supportedLevels,
          correlationId,
        );
      }
      return requestedEffort;
    }

    // Effort omitted
    if (supportsReasoning && resolution.capabilities.defaultEffortLevel) {
      return resolution.capabilities.defaultEffortLevel;
    }

    return undefined;
  }

  private validateContextWindow(
    messages: readonly ChatMessage[],
    resolution: ModelResolutionResult,
    requestedMaxTokens: number | undefined,
    correlationId: string,
  ): void {
    const contextLimit = resolution.limits.contextWindowTokens;
    const check = ContextWindowEstimator.isWithinLimit(messages, contextLimit, requestedMaxTokens);

    if (!check.valid) {
      throw new ContextWindowExceededError(
        resolution.canonicalModelId,
        contextLimit,
        check.estimatedTokens,
        correlationId,
      );
    }
  }

  private calculateBudget(requestedTimeoutMs?: number): {
    readonly deadlineMs: number;
    readonly timeoutMs: number;
  } {
    let timeoutMs = requestedTimeoutMs ?? this.defaultTimeoutMs;
    if (timeoutMs <= 0) {
      timeoutMs = this.defaultTimeoutMs;
    }
    if (timeoutMs > this.maxTimeoutMs) {
      timeoutMs = this.maxTimeoutMs;
    }

    const deadlineMs = Date.now() + timeoutMs;
    return { deadlineMs, timeoutMs };
  }

  private normalizeError(
    err: unknown,
    signal?: AbortSignal,
    correlationId = '',
  ): OrchestratorError {
    if (err instanceof OrchestratorError) {
      return err;
    }

    if (signal?.aborted) {
      if (signal.reason instanceof OrchestratorError) {
        return signal.reason;
      }
      return new RequestCancelledError(
        'Inference request was cancelled by the caller.',
        correlationId,
      );
    }

    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('abort') || msg.includes('cancel')) {
        return new RequestCancelledError(
          'Inference request was cancelled by the caller.',
          correlationId,
        );
      }
      if (msg.includes('timeout') || msg.includes('deadline')) {
        return new InferenceTimeoutError(err.message, correlationId);
      }
      if (msg.includes('registry') || msg.includes('econnrefused')) {
        return new RegistryUnavailableError(err.message, correlationId);
      }
      if (msg.includes('target') || msg.includes('circuit')) {
        return new AllTargetsExhaustedError(err.message, correlationId);
      }
      return new OrchestratorError(
        'INTERNAL_ORCHESTRATOR_ERROR',
        'An internal error occurred during orchestration',
        500,
        false,
        { original: err.message },
        undefined,
        correlationId,
      );
    }

    return new OrchestratorError(
      'INTERNAL_ORCHESTRATOR_ERROR',
      'An unexpected error occurred during orchestration',
      500,
      false,
      undefined,
      undefined,
      correlationId,
    );
  }
}
