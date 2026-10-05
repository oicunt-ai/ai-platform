import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  MessageContentPart,
  NormalizedCompletionData,
  StreamEvent,
} from '@oicunt-ai/ai-types';
import type { AiMetricsRecorder, AiTracer } from '@oicunt-ai/observability';
import { NoopAiMetricsRecorder, NoopAiTracer } from '@oicunt-ai/observability';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  ExecutionBudget,
  GatewayError,
  InferenceTimeoutError,
  InternalGatewayError,
  RequestCancelledError,
  StreamInterruptedError,
  UnsupportedCapabilityError,
  type RetryPolicyConfig,
} from '../../domain/index.js';
import type { GatewayDispatchPayload, ResolvedTargetDto } from '../dtos/dispatch.dto.js';
import type { AdapterRegistryPort } from '../ports/adapter-registry.port.js';
import type { CircuitBreakerStorePort } from '../ports/circuit-breaker-store.port.js';

export interface DispatchModelUseCaseDependencies {
  readonly adapterRegistry: AdapterRegistryPort;
  readonly circuitBreakerStore: CircuitBreakerStorePort;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
  readonly retryPolicy?: RetryPolicyConfig | undefined;
  readonly defaultTimeoutMs?: number | undefined;
}

export class DispatchModelUseCase {
  private readonly adapterRegistry: AdapterRegistryPort;
  private readonly circuitBreakerStore: CircuitBreakerStorePort;
  private readonly tracer: AiTracer;
  private readonly metrics: AiMetricsRecorder;
  private readonly retryPolicy: RetryPolicyConfig;
  private readonly defaultTimeoutMs: number;

  constructor(deps: DispatchModelUseCaseDependencies) {
    this.adapterRegistry = deps.adapterRegistry;
    this.circuitBreakerStore = deps.circuitBreakerStore;
    this.tracer = deps.tracer ?? new NoopAiTracer();
    this.metrics = deps.metrics ?? new NoopAiMetricsRecorder();
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? 120000;
    this.retryPolicy = deps.retryPolicy ?? {
      maxAttemptsPerTarget: 3,
      maxFallbackAttempts: 2,
      maxTotalExecutionAttempts: 4,
      initialBackoffDelayMs: 500,
      maxBackoffDelayMs: 8000,
      backoffMultiplier: 2.0,
    };
  }

  /**
   * Executes a unary (non-streaming) model completion request.
   */
  public async executeUnary(
    payload: GatewayDispatchPayload,
    parentSignal?: AbortSignal,
  ): Promise<NormalizedCompletionData> {
    if (parentSignal?.aborted) {
      throw new RequestCancelledError(payload.canonicalModelId, payload.correlationId);
    }

    this.validatePayload(payload);

    const budget = new ExecutionBudget({
      deadlineMs: payload.deadlineMs ?? Date.now() + this.defaultTimeoutMs,
      maxAttemptsPerTarget: this.retryPolicy.maxAttemptsPerTarget,
      maxFallbackAttempts: payload.routingPolicy.maxFallbackAttempts,
      maxTotalExecutionAttempts: this.retryPolicy.maxTotalExecutionAttempts,
      parentSignal,
    });

    const orderedTargets = this.orderTargets(payload.eligibleTargets);

    for (const target of orderedTargets) {
      const breaker = this.circuitBreakerStore.getBreaker(target.targetId);
      if (!breaker.canExecute()) {
        continue;
      }

      if (!budget.canAttemptTarget(target.targetId)) {
        continue;
      }

      const adapter = this.adapterRegistry.getAdapter(target.provider);
      if (!adapter) {
        breaker.recordFailure();
        continue;
      }

      let attemptInTarget = 0;
      while (budget.canAttemptTarget(target.targetId)) {
        if (parentSignal?.aborted) {
          throw new RequestCancelledError(payload.canonicalModelId, payload.correlationId);
        }

        attemptInTarget += 1;
        budget.recordAttempt(target.targetId);

        const completionId = randomUUID();
        const { signal, cleanup, attemptTimeoutMs } = budget.createAttemptSignal();
        const startTime = Date.now();

        try {
          const rawResult = await adapter.executeUnary({
            requestId: payload.requestId,
            correlationId: payload.correlationId,
            completionId,
            target,
            payload,
            attemptTimeoutMs,
            cancellationSignal: signal,
          });

          cleanup();
          breaker.recordSuccess();

          const sanitizedResult = this.applyReasoningPrivacyUnary(rawResult, payload);
          this.recordTelemetry(payload, target, sanitizedResult, Date.now() - startTime);

          return sanitizedResult;
        } catch (err: unknown) {
          cleanup();
          breaker.recordFailure();

          const normalized = this.normalizeError(err, payload, target.targetId);

          if (parentSignal?.aborted || normalized.code === 'REQUEST_CANCELLED') {
            throw new RequestCancelledError(payload.canonicalModelId, payload.correlationId);
          }

          // Non-retryable client errors terminate execution immediately without fallback
          if (
            normalized.code === 'CONTEXT_WINDOW_EXCEEDED' ||
            normalized.code === 'INVALID_REQUEST' ||
            normalized.code === 'CONTENT_POLICY_VIOLATION'
          ) {
            throw normalized;
          }

          // Provider auth or unsupported effort: skip to next target immediately
          if (
            normalized.code === 'PROVIDER_AUTHENTICATION_ERROR' ||
            normalized.code === 'UNSUPPORTED_EFFORT_LEVEL'
          ) {
            break;
          }

          // Retryable error: backoff with jitter if budget allows
          if (normalized.retryable && budget.canAttemptTarget(target.targetId)) {
            if (parentSignal?.aborted) {
              throw new RequestCancelledError(payload.canonicalModelId, payload.correlationId);
            }
            const delay = this.calculateJitterDelay(attemptInTarget);
            try {
              await this.sleep(delay, parentSignal);
            } catch (sleepErr) {
              if (parentSignal?.aborted) {
                throw new RequestCancelledError(payload.canonicalModelId, payload.correlationId);
              }
              throw sleepErr;
            }
          } else {
            break;
          }
        }
      }
    }

    if (parentSignal?.aborted) {
      throw new RequestCancelledError(payload.canonicalModelId, payload.correlationId);
    }

    if (budget.isDeadlineExceeded()) {
      throw new InferenceTimeoutError(
        payload.canonicalModelId,
        payload.correlationId,
        undefined,
        'Overall request execution deadline exceeded across all eligible targets',
      );
    }

    throw new AllTargetsExhaustedError(payload.canonicalModelId, payload.correlationId);
  }

  /**
   * Executes a streaming model completion request yielding normalized StreamEvents.
   */
  public async *executeStream(
    payload: GatewayDispatchPayload,
    parentSignal?: AbortSignal,
  ): AsyncIterable<StreamEvent> {
    if (parentSignal?.aborted) {
      yield {
        event: 'error',
        data: {
          code: 'REQUEST_CANCELLED',
          message: 'Inference request was cancelled by caller.',
        },
      };
      return;
    }

    this.validatePayload(payload);

    const budget = new ExecutionBudget({
      deadlineMs: payload.deadlineMs ?? Date.now() + this.defaultTimeoutMs,
      maxAttemptsPerTarget: this.retryPolicy.maxAttemptsPerTarget,
      maxFallbackAttempts: payload.routingPolicy.maxFallbackAttempts,
      maxTotalExecutionAttempts: this.retryPolicy.maxTotalExecutionAttempts,
      parentSignal,
    });

    const orderedTargets = this.orderTargets(payload.eligibleTargets);
    let hasYieldedToCaller = false;
    let lastError: GatewayError | null = null;

    for (const target of orderedTargets) {
      // FIX 3: Skip non-streaming targets
      if (!target.supportsStreaming) {
        continue;
      }

      const breaker = this.circuitBreakerStore.getBreaker(target.targetId);
      if (!breaker.canExecute()) {
        continue;
      }

      if (!budget.canAttemptTarget(target.targetId)) {
        continue;
      }

      const adapter = this.adapterRegistry.getAdapter(target.provider);
      if (!adapter) {
        lastError = new UnsupportedCapabilityError(
          payload.canonicalModelId,
          `Provider '${target.provider}' is not supported`,
          payload.correlationId,
          target.targetId,
        );
        breaker.recordFailure();
        continue;
      }

      let attemptInTarget = 0;
      while (budget.canAttemptTarget(target.targetId)) {
        attemptInTarget += 1;
        budget.recordAttempt(target.targetId);

        const completionId = randomUUID();
        const { signal, cleanup, attemptTimeoutMs } = budget.createAttemptSignal();

        try {
          const rawStream = adapter.executeStream({
            requestId: payload.requestId,
            correlationId: payload.correlationId,
            completionId,
            target,
            payload,
            attemptTimeoutMs,
            cancellationSignal: signal,
          });

          for await (const event of rawStream) {
            if (event.event === 'thinking') {
              // Privacy invariant: only yield thinking if explicitly authorized by policy
              if (payload.exposeReasoning === true) {
                hasYieldedToCaller = true;
                yield event;
              }
              continue;
            }

            if (event.event === 'token' || event.event === 'tool_call') {
              hasYieldedToCaller = true;
              yield event;
              continue;
            }

            if (event.event === 'finish') {
              breaker.recordSuccess();
              yield event;
              cleanup();
              return;
            }

            if (event.event === 'error') {
              throw new StreamInterruptedError(
                payload.canonicalModelId,
                payload.correlationId,
                target.targetId,
              );
            }
          }

          cleanup();
          return;
        } catch (err: unknown) {
          cleanup();
          breaker.recordFailure();

          const normalized = this.normalizeError(err, payload, target.targetId);
          lastError = normalized;

          // Invariant 7: If any event was already yielded, retrying or falling back is prohibited
          if (hasYieldedToCaller) {
            yield {
              event: 'error',
              data: {
                code: normalized.code,
                message: normalized.message,
              },
            };
            return;
          }

          if (
            normalized.code === 'CONTEXT_WINDOW_EXCEEDED' ||
            normalized.code === 'INVALID_REQUEST' ||
            normalized.code === 'CONTENT_POLICY_VIOLATION'
          ) {
            yield {
              event: 'error',
              data: {
                code: normalized.code,
                message: normalized.message,
              },
            };
            return;
          }

          if (
            normalized.code === 'PROVIDER_AUTHENTICATION_ERROR' ||
            normalized.code === 'UNSUPPORTED_EFFORT_LEVEL'
          ) {
            break;
          }

          if (normalized.retryable && budget.canAttemptTarget(target.targetId)) {
            if (parentSignal?.aborted) {
              yield {
                event: 'error',
                data: {
                  code: 'REQUEST_CANCELLED',
                  message: 'Inference request was cancelled by caller.',
                },
              };
              return;
            }
            const delay = this.calculateJitterDelay(attemptInTarget);
            try {
              await this.sleep(delay, parentSignal);
            } catch (sleepErr) {
              if (parentSignal?.aborted) {
                yield {
                  event: 'error',
                  data: {
                    code: 'REQUEST_CANCELLED',
                    message: 'Inference request was cancelled by caller.',
                  },
                };
                return;
              }
              throw sleepErr;
            }
          } else {
            break;
          }
        }
      }
    }

    if (!hasYieldedToCaller) {
      if (parentSignal?.aborted) {
        yield {
          event: 'error',
          data: {
            code: 'REQUEST_CANCELLED',
            message: 'Inference request was cancelled by caller.',
          },
        };
        return;
      }

      const finalError =
        lastError ?? new AllTargetsExhaustedError(payload.canonicalModelId, payload.correlationId);
      yield {
        event: 'error',
        data: {
          code: finalError.code,
          message: finalError.message,
        },
      };
    }
  }

  private validatePayload(payload: GatewayDispatchPayload): void {
    if (!payload.eligibleTargets || payload.eligibleTargets.length === 0) {
      throw new AllTargetsExhaustedError(payload.canonicalModelId, payload.correlationId);
    }

    // Context limit check
    if (payload.limits?.contextWindowTokens) {
      const roughPromptTokens = this.estimatePromptTokens(payload.messages);
      const requestedMaxTokens = payload.parameters?.maxTokens ?? 0;
      if (roughPromptTokens + requestedMaxTokens > payload.limits.contextWindowTokens) {
        throw new ContextWindowExceededError(payload.canonicalModelId, payload.correlationId, {
          estimatedTokens: roughPromptTokens + requestedMaxTokens,
          contextWindowLimit: payload.limits.contextWindowTokens,
        });
      }
    }
  }

  private estimatePromptTokens(messages: readonly ChatMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            totalChars += part.text.length;
          }
        }
      }
    }
    // Standard rule of thumb: ~4 characters per token
    return Math.ceil(totalChars / 4);
  }

  private orderTargets(targets: readonly ResolvedTargetDto[]): readonly ResolvedTargetDto[] {
    return [...targets].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return b.weight - a.weight;
    });
  }

  private applyReasoningPrivacyUnary(
    data: NormalizedCompletionData,
    payload: GatewayDispatchPayload,
  ): NormalizedCompletionData {
    if (payload.exposeReasoning === true) {
      return data;
    }

    if (!Array.isArray(data.message.content)) {
      return data;
    }

    const filteredParts = (data.message.content as MessageContentPart[]).filter(
      (part) => part.type !== 'thinking',
    );

    return {
      ...data,
      message: {
        ...data.message,
        content: filteredParts.length > 0 ? filteredParts : '',
      },
    };
  }

  private normalizeError(
    err: unknown,
    payload: GatewayDispatchPayload,
    targetId: string,
  ): GatewayError {
    if (err instanceof GatewayError) {
      return err;
    }

    if (err instanceof Error) {
      if (err.name === 'AbortError' || err.message.includes('aborted')) {
        return new RequestCancelledError(payload.canonicalModelId, payload.correlationId);
      }
      if (err.message.includes('timed out')) {
        return new InferenceTimeoutError(
          payload.canonicalModelId,
          payload.correlationId,
          targetId,
          'Target request timed out',
        );
      }
    }

    return new InternalGatewayError(
      payload.canonicalModelId,
      payload.correlationId,
      err instanceof Error ? err.message : 'Unknown gateway execution failure',
    );
  }

  private calculateJitterDelay(attempt: number): number {
    const { initialBackoffDelayMs, backoffMultiplier, maxBackoffDelayMs } = this.retryPolicy;
    const maxDelay = Math.min(
      maxBackoffDelayMs,
      initialBackoffDelayMs * Math.pow(backoffMultiplier, attempt),
    );
    return Math.floor(Math.random() * maxDelay);
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    if (signal?.aborted) {
      throw signal.reason ?? new Error('Aborted during backoff');
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timeout);
            reject(signal.reason ?? new Error('Aborted during backoff'));
          },
          { once: true },
        );
      }
    });
  }

  private recordTelemetry(
    payload: GatewayDispatchPayload,
    target: ResolvedTargetDto,
    result: NormalizedCompletionData,
    durationMs: number,
  ): void {
    const span = this.tracer.startSpan('model_gateway.dispatch', {
      'gen_ai.system': target.provider,
      'gen_ai.request.model': target.upstreamModelId,
      'gen_ai.usage.input_tokens': result.usage.promptTokens,
      'gen_ai.usage.output_tokens': result.usage.completionTokens,
      'oicunt.canonical_model': payload.canonicalModelId,
      'oicunt.model_version': payload.version,
      'oicunt.target_id': target.targetId,
      'oicunt.correlation_id': payload.correlationId,
      'oicunt.request_id': payload.requestId,
      'oicunt.completion_id': result.completionId,
    });
    span.end();

    this.metrics.recordInferenceDuration(payload.canonicalModelId, durationMs, {
      provider: target.provider,
      targetId: target.targetId,
    });
    this.metrics.recordTokenUsage(payload.canonicalModelId, result.usage, {
      provider: target.provider,
    });

    if (payload.pricing) {
      const costUsd =
        (result.usage.promptTokens / 1_000_000) * payload.pricing.costPerMillionInputTokens +
        (result.usage.completionTokens / 1_000_000) * payload.pricing.costPerMillionOutputTokens;
      this.metrics.recordEstimatedCost(payload.canonicalModelId, costUsd, {
        provider: target.provider,
      });
    }
  }
}
