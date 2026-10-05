import type { AiMetricsRecorder, AiTracer } from '@oicunt-ai/observability';
import { NoopAiMetricsRecorder, NoopAiTracer } from '@oicunt-ai/observability';
import type { StreamEvent } from '@oicunt-ai/ai-types';
import {
  AllTargetsExhaustedError,
  InferenceError,
  InferenceTimeoutError,
  InternalInferenceError,
  ModelUnavailableError,
  RequestCancelledError,
} from '../../domain/errors.js';
import { validateInferenceRequest } from '../../domain/validation.js';
import { calculateInferenceCost } from '../../domain/cost-calculator.js';
import type {
  InferenceExecutionContext,
  InferenceExecutionMetadata,
  InferenceReasoningPrivacyPolicy,
} from '../../domain/types.js';
import type { InferenceExecutionRequest } from '../dtos/inference-execution.dto.js';
import type {
  InferenceExecutionResponse,
  InferenceResultData,
} from '../dtos/inference-result.dto.js';
import type { GatewayDispatchPayload, ModelGatewayPort } from '../ports/model-gateway.port.js';
import type { InferenceHookPort } from '../ports/inference-hook.port.js';

export interface ExecuteInferenceOptions {
  readonly modelGateway: ModelGatewayPort;
  readonly hook?: InferenceHookPort | undefined;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
  readonly defaultTimeoutMs?: number | undefined;
  readonly maxTimeoutMs?: number | undefined;
  readonly privacyPolicy?: InferenceReasoningPrivacyPolicy | undefined;
}

export class ExecuteInferenceUseCase {
  private readonly modelGateway: ModelGatewayPort;
  private readonly hook?: InferenceHookPort | undefined;
  private readonly tracer: AiTracer;
  private readonly metrics: AiMetricsRecorder;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly privacyPolicy: InferenceReasoningPrivacyPolicy;

  constructor(options: ExecuteInferenceOptions) {
    this.modelGateway = options.modelGateway;
    this.hook = options.hook;
    this.tracer = options.tracer ?? new NoopAiTracer();
    this.metrics = options.metrics ?? new NoopAiMetricsRecorder();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
    this.maxTimeoutMs = options.maxTimeoutMs ?? 300_000;
    this.privacyPolicy = options.privacyPolicy ?? {
      exposeReasoning: true,
      redactThinking: false,
      redactThinkingInLogs: true,
    };
  }

  /**
   * Executes unary inference: validates request, checks deadline, executes lifecycle hooks,
   * dispatches to Model Gateway, and returns normalized response.
   */
  public async executeUnary(
    request: InferenceExecutionRequest,
    context: InferenceExecutionContext,
    parentSignal?: AbortSignal,
  ): Promise<InferenceExecutionResponse> {
    const startTime = Date.now();
    validateInferenceRequest(request, context.correlationId);

    const remainingMs = request.deadlineMs - startTime;
    if (remainingMs <= 0) {
      throw new InferenceTimeoutError(0, context.correlationId, {
        deadlineMs: request.deadlineMs,
        now: startTime,
        reason: 'Deadline expired prior to execution',
      });
    }

    const timeoutMs = Math.min(remainingMs, this.maxTimeoutMs);

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
        if (parentSignal.reason instanceof InferenceError) {
          throw parentSignal.reason;
        }
        throw new RequestCancelledError(
          parentSignal.reason instanceof Error
            ? parentSignal.reason.message
            : 'Inference request was cancelled by the caller.',
          context.correlationId,
        );
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const span = this.tracer.startSpan('inference.execution', {
      'oicunt.service': 'inference',
      'oicunt.canonical_model': request.canonicalModelId,
      'oicunt.model_version': request.version,
      'oicunt.effort': request.effort ?? 'none',
      'oicunt.stream': false,
      'oicunt.correlation_id': context.correlationId,
      'oicunt.request_id': context.requestId,
      'oicunt.turn_id': context.requestId,
    });

    try {
      if (this.hook) {
        await this.hook.beforeExecution(request, abortController.signal);
      }

      const exposeReasoning =
        request.privacyPolicy?.exposeReasoning ?? this.privacyPolicy.exposeReasoning ?? true;

      const payload: GatewayDispatchPayload = {
        requestId: context.requestId,
        correlationId: context.correlationId,
        conversationId: request.conversationId ?? context.conversationId,
        canonicalModelId: request.canonicalModelId,
        version: request.version,
        messages: request.messages,
        parameters: request.parameters,
        effort: request.effort,
        tools: request.tools,
        stream: false,
        limits: request.limits,
        pricing: request.pricing,
        eligibleTargets: request.eligibleTargets,
        routingPolicy: request.routingPolicy,
        tenantId: context.tenantId ?? request.tenantId,
        userId: context.userId ?? request.userId,
        actorId: context.actorId,
        metadata: request.metadata,
        deadlineMs: request.deadlineMs,
        exposeReasoning,
      };

      const completion = await this.modelGateway.dispatchUnary(payload, abortController.signal);

      const latencyMs = Date.now() - startTime;
      const estimatedCostUsd = calculateInferenceCost(request.pricing, completion.usage);
      const tokensPerSecond =
        latencyMs > 0
          ? Number(((completion.usage.completionTokens / latencyMs) * 1000).toFixed(1))
          : undefined;

      // Reasoning Privacy: Sanitize assistant message if exposeReasoning is false
      let finalMessage = completion.message;
      if (!exposeReasoning && Array.isArray(finalMessage.content)) {
        const filteredParts = finalMessage.content.filter((part) => part.type !== 'thinking');
        finalMessage = { ...finalMessage, content: filteredParts };
      }

      const metadata: InferenceExecutionMetadata = {
        latencyMs,
        tokensPerSecond,
        estimatedCostUsd,
      };

      const resultData: InferenceResultData = {
        completionId: completion.completionId,
        model: completion.model,
        version: request.version,
        effort: request.effort,
        message: finalMessage,
        finishReason: completion.finishReason,
        usage: completion.usage,
        metadata,
      };

      if (this.hook) {
        await this.hook.afterExecution(request, resultData, abortController.signal);
      }

      this.metrics.recordInferenceDuration(request.canonicalModelId, latencyMs, {
        status: 'success',
        stream: 'false',
      });
      this.metrics.recordTokenUsage(request.canonicalModelId, completion.usage, {
        stream: 'false',
      });

      span.setAttribute('gen_ai.usage.prompt_tokens', completion.usage.promptTokens);
      span.setAttribute('gen_ai.usage.completion_tokens', completion.usage.completionTokens);
      span.setAttribute('gen_ai.usage.total_tokens', completion.usage.totalTokens);
      span.setAttribute('oicunt.inference.duration_ms', latencyMs);
      span.setStatus('ok');
      span.end();

      return {
        success: true,
        data: resultData,
        meta: {
          requestId: context.requestId,
          correlationId: context.correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: unknown) {
      const normalized = this.normalizeError(
        err,
        abortController.signal,
        context.correlationId,
        request.canonicalModelId,
      );
      span.setStatus('error', normalized.message);
      span.setAttribute('error.code', normalized.code);
      span.end();

      throw normalized;
    } finally {
      clearTimeout(timeoutHandle);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  /**
   * Executes streaming inference: validates request, checks deadline, dispatches to Model Gateway,
   * enforces Zero Mid-Stream Retry Invariant, filters reasoning events if required, and streams SSE chunks.
   */
  public async *executeStream(
    request: InferenceExecutionRequest,
    context: InferenceExecutionContext,
    parentSignal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    const startTime = Date.now();
    validateInferenceRequest(request, context.correlationId);

    const remainingMs = request.deadlineMs - startTime;
    if (remainingMs <= 0) {
      throw new InferenceTimeoutError(0, context.correlationId, {
        deadlineMs: request.deadlineMs,
        now: startTime,
        reason: 'Deadline expired prior to execution',
      });
    }

    const timeoutMs = Math.min(remainingMs, this.maxTimeoutMs);

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
        if (parentSignal.reason instanceof InferenceError) {
          throw parentSignal.reason;
        }
        throw new RequestCancelledError(
          parentSignal.reason instanceof Error
            ? parentSignal.reason.message
            : 'Inference request was cancelled by the caller.',
          context.correlationId,
        );
      }
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const span = this.tracer.startSpan('inference.execution', {
      'oicunt.service': 'inference',
      'oicunt.canonical_model': request.canonicalModelId,
      'oicunt.model_version': request.version,
      'oicunt.effort': request.effort ?? 'none',
      'oicunt.stream': true,
      'oicunt.correlation_id': context.correlationId,
      'oicunt.request_id': context.requestId,
      'oicunt.turn_id': context.requestId,
    });

    let emittedFirstEvent = false;
    let ttftMs: number | undefined;

    try {
      if (this.hook) {
        await this.hook.beforeExecution(request, abortController.signal);
      }

      const exposeReasoning =
        request.privacyPolicy?.exposeReasoning ?? this.privacyPolicy.exposeReasoning ?? true;

      const payload: GatewayDispatchPayload = {
        requestId: context.requestId,
        correlationId: context.correlationId,
        conversationId: request.conversationId ?? context.conversationId,
        canonicalModelId: request.canonicalModelId,
        version: request.version,
        messages: request.messages,
        parameters: request.parameters,
        effort: request.effort,
        tools: request.tools,
        stream: true,
        limits: request.limits,
        pricing: request.pricing,
        eligibleTargets: request.eligibleTargets,
        routingPolicy: request.routingPolicy,
        tenantId: context.tenantId ?? request.tenantId,
        userId: context.userId ?? request.userId,
        actorId: context.actorId,
        metadata: request.metadata,
        deadlineMs: request.deadlineMs,
        exposeReasoning,
      };

      const stream = this.modelGateway.dispatchStream(payload, abortController.signal);

      for await (const event of stream) {
        // Measure Time-to-First-Token (TTFT)
        if (
          !emittedFirstEvent &&
          (event.event === 'token' || event.event === 'thinking' || event.event === 'tool_call')
        ) {
          emittedFirstEvent = true;
          ttftMs = Date.now() - startTime;
          span.setAttribute('oicunt.inference.ttft_ms', ttftMs);
        }

        // Reasoning Privacy: Strip thinking events if exposeReasoning is false
        if (event.event === 'thinking' && !exposeReasoning) {
          continue;
        }

        if (event.event === 'finish') {
          const latencyMs = Date.now() - startTime;
          this.metrics.recordInferenceDuration(request.canonicalModelId, latencyMs, {
            status: 'success',
            stream: 'true',
          });
          this.metrics.recordTokenUsage(request.canonicalModelId, event.data.usage, {
            stream: 'true',
          });
          span.setAttribute('gen_ai.usage.prompt_tokens', event.data.usage.promptTokens);
          span.setAttribute('gen_ai.usage.completion_tokens', event.data.usage.completionTokens);
          span.setAttribute('gen_ai.usage.total_tokens', event.data.usage.totalTokens);
          span.setAttribute('oicunt.inference.duration_ms', latencyMs);
          span.setStatus('ok');
        }

        yield event;
      }

      span.end();
    } catch (err: unknown) {
      const normalized = this.normalizeError(
        err,
        abortController.signal,
        context.correlationId,
        request.canonicalModelId,
      );
      span.setStatus('error', normalized.message);
      span.setAttribute('error.code', normalized.code);
      span.end();

      // Zero Mid-Stream Retry Invariant:
      // If output was already emitted across the wire, do NOT throw an unhandled exception or retry.
      // Instead, yield a terminal 'error' event to cleanly close the SSE stream.
      if (emittedFirstEvent) {
        yield {
          event: 'error',
          data: {
            code: normalized.code,
            message: normalized.message,
            details: normalized.details,
          },
        };
      } else {
        throw normalized;
      }
    } finally {
      clearTimeout(timeoutHandle);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    }
  }

  private normalizeError(
    err: unknown,
    signal?: AbortSignal,
    correlationId = '',
    canonicalModelId = '',
  ): InferenceError {
    if (err instanceof InferenceError) {
      return err;
    }

    if (signal?.aborted) {
      if (signal.reason instanceof InferenceError) {
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
        return new InferenceTimeoutError(this.defaultTimeoutMs, correlationId);
      }
      if (msg.includes('target') || msg.includes('circuit')) {
        return new AllTargetsExhaustedError(err.message, correlationId);
      }
      if (msg.includes('unavailable') || msg.includes('econnrefused')) {
        return new ModelUnavailableError(canonicalModelId, err.message, correlationId);
      }
      return new InternalInferenceError(err.message, correlationId);
    }

    return new InternalInferenceError(
      'An unexpected error occurred during inference execution',
      correlationId,
    );
  }

  public getDefaultTimeoutMs(): number {
    return this.defaultTimeoutMs;
  }

  public getMaxTimeoutMs(): number {
    return this.maxTimeoutMs;
  }
}
