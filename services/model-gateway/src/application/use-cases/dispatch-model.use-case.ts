import { randomUUID } from 'node:crypto';
import type {
  ChatMessage,
  MessageContentPart,
  NormalizedCompletionData,
  StreamEvent,
} from '@oicunt-ai/ai-types';
import type { TokenUsage } from '@oicunt-ai/model-types';
import type { AiMetricsRecorder, AiTracer } from '@oicunt-ai/observability';
import { NoopAiMetricsRecorder, NoopAiTracer } from '@oicunt-ai/observability';
import {
  AllTargetsExhaustedError,
  ContextWindowExceededError,
  ExecutionBudget,
  GatewayError,
  InferenceTimeoutError,
  InternalGatewayError,
  MeteringCaptureUnavailableError,
  RequestCancelledError,
  StreamInterruptedError,
  UnsupportedCapabilityError,
  type RetryPolicyConfig,
} from '../../domain/index.js';
import type { GatewayDispatchPayload, ResolvedTargetDto } from '../dtos/dispatch.dto.js';
import type { AdapterRegistryPort } from '../ports/adapter-registry.port.js';
import type { CircuitBreakerStorePort } from '../ports/circuit-breaker-store.port.js';
import type { MeteringCapturePort } from '../ports/metering-capture.port.js';
import type { UsageEvent } from '@oicunt-ai/usage-types';

export interface DispatchModelUseCaseDependencies {
  readonly adapterRegistry: AdapterRegistryPort;
  readonly circuitBreakerStore: CircuitBreakerStorePort;
  readonly tracer?: AiTracer | undefined;
  readonly metrics?: AiMetricsRecorder | undefined;
  readonly retryPolicy?: RetryPolicyConfig | undefined;
  readonly defaultTimeoutMs?: number | undefined;
  /**
   * Durable metering capture (P1 outbox). When present, provider usage is
   * captured to PostgreSQL before success is reported; RabbitMQ delivery
   * happens asynchronously via the outbox drainer (P2). When absent,
   * metering is disabled and execution behavior is unchanged.
   */
  readonly meteringCapture?: MeteringCapturePort | undefined;
  readonly meteringCaptureTimeoutMs?: number | undefined;
}

export class DispatchModelUseCase {
  private readonly adapterRegistry: AdapterRegistryPort;
  private readonly circuitBreakerStore: CircuitBreakerStorePort;
  private readonly tracer: AiTracer;
  private readonly metrics: AiMetricsRecorder;
  private readonly retryPolicy: RetryPolicyConfig;
  private readonly defaultTimeoutMs: number;
  private readonly meteringCapture?: MeteringCapturePort | undefined;
  private readonly meteringCaptureTimeoutMs: number;

  constructor(deps: DispatchModelUseCaseDependencies) {
    this.adapterRegistry = deps.adapterRegistry;
    this.circuitBreakerStore = deps.circuitBreakerStore;
    this.tracer = deps.tracer ?? new NoopAiTracer();
    this.metrics = deps.metrics ?? new NoopAiMetricsRecorder();
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? 120000;
    this.meteringCapture = deps.meteringCapture;
    this.meteringCaptureTimeoutMs = deps.meteringCaptureTimeoutMs ?? 2000;
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
        let providerFinished = false;

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
          // The provider outcome is decided here, before any metering.
          // A later metering failure must not rewrite this verdict.
          breaker.recordSuccess();

          const sanitizedResult = this.applyReasoningPrivacyUnary(rawResult, payload);
          providerFinished = true;
          // Durable metering capture, isolated from the provider outcome:
          // any failure throws METERING_CAPTURE_UNAVAILABLE directly (see
          // the providerFinished guard in catch below) without touching the
          // breaker and without triggering another provider attempt.
          await this.captureCompletionUsage(payload, target, sanitizedResult);
          this.recordTelemetry(payload, target, sanitizedResult, Date.now() - startTime);

          return sanitizedResult;
        } catch (err: unknown) {
          cleanup();
          if (providerFinished) {
            // The provider already succeeded; this error came from metering
            // capture (or terminal handling) after success. Never mark the
            // provider unhealthy and never retry: a retry would perform a
            // second real provider call for consumption already delivered.
            // NOTE: a post-provider capture failure can still leave
            // provider-side usage requiring out-of-band reconciliation —
            // METERING_CAPTURE_UNAVAILABLE reports that gap honestly instead
            // of claiming zero unbilled consumption.
            throw err;
          }
          breaker.recordFailure();

          const normalized = this.normalizeError(err, payload, target.targetId);
          if (!providerFinished) {
            await this.captureFailedAttemptUsageBounded(
              payload,
              target,
              completionId,
              normalized.code,
              undefined,
            );
          }

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
        let providerFinished = false;
        // Last provider-reported usage observed before a failure, if any.
        // Adapter error events may carry it; token events never do.
        let lastKnownUsage: TokenUsage | undefined;

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
              providerFinished = true;
              // The provider outcome is decided here, before any metering.
              breaker.recordSuccess();
              const completion = {
                completionId,
                model: payload.canonicalModelId,
                message: { role: 'assistant', content: '' },
                finishReason: event.data.finishReason,
                usage: event.data.usage,
                latencyMs: 0,
              } satisfies NormalizedCompletionData;
              try {
                // Durable capture BEFORE yielding finish: nothing after
                // `yield finish` may be relied upon to execute.
                await this.captureCompletionUsage(payload, target, completion);
              } catch (captureErr: unknown) {
                // Metering failed after provider success. Report honestly
                // instead of finish; never retry (tokens were already
                // streamed) and never blame the provider.
                const captureCode =
                  captureErr instanceof MeteringCaptureUnavailableError
                    ? captureErr.code
                    : 'METERING_CAPTURE_UNAVAILABLE';
                yield {
                  event: 'error',
                  data: {
                    code: captureCode,
                    message:
                      'Usage metering capture is temporarily unavailable; the AI provider ' +
                      'result was not durably recorded.',
                  },
                };
                cleanup();
                return;
              }
              yield event;
              cleanup();
              return;
            }

            if (event.event === 'error') {
              if (event.data.usage) {
                lastKnownUsage = event.data.usage;
              }
              throw new StreamInterruptedError(
                payload.canonicalModelId,
                payload.correlationId,
                target.targetId,
              );
            }
          }

          // A provider stream that ends cleanly without a finish event has a
          // defined metering outcome: it is an interruption, never a silent
          // non-event — delivered tokens would otherwise go unbilled.
          throw new StreamInterruptedError(
            payload.canonicalModelId,
            payload.correlationId,
            target.targetId,
          );
        } catch (err: unknown) {
          cleanup();
          if (providerFinished) {
            // The provider already succeeded; this error came from metering
            // or delivery after success. Never mark the provider unhealthy
            // and never retry.
            const terminal = this.normalizeError(err, payload, target.targetId);
            yield {
              event: 'error',
              data: {
                code: terminal.code,
                message: terminal.message,
              },
            };
            return;
          }
          breaker.recordFailure();

          const normalized = this.normalizeError(err, payload, target.targetId);
          lastError = normalized;
          if (!providerFinished) {
            await this.captureFailedAttemptUsageBounded(
              payload,
              target,
              completionId,
              normalized.code,
              lastKnownUsage,
            );
          }

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

    // Billing identity gate: when metering is enabled, a missing tenant can
    // never produce a valid usage event, so fail HERE — before any provider
    // tokens are consumed — instead of after a provider call. actorId and
    // userId stay optional (omitted identities are valid downstream).
    // When metering is disabled no event is built and no gate applies.
    if (this.meteringCapture !== undefined && !payload.tenantId) {
      throw new InternalGatewayError(
        payload.canonicalModelId,
        payload.correlationId,
        'Tenant context is required for usage accounting',
      );
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

  /**
   * Durably captures a successful completion's usage event BEFORE the caller
   * reports provider success. Isolated from the provider outcome: any
   * failure rejects with METERING_CAPTURE_UNAVAILABLE (never a provider
   * error type) and callers must let it propagate without touching the
   * circuit breaker or triggering another provider attempt.
   */
  private async captureCompletionUsage(
    payload: GatewayDispatchPayload,
    target: ResolvedTargetDto,
    completion: NormalizedCompletionData,
  ): Promise<void> {
    if (!this.meteringCapture) return;
    const event = this.buildCompletionUsageEvent(payload, target, completion);
    try {
      await this.meteringCapture.capture(event, { timeoutMs: this.meteringCaptureTimeoutMs });
    } catch (error) {
      if (error instanceof MeteringCaptureUnavailableError) {
        throw error;
      }
      throw new MeteringCaptureUnavailableError(
        payload.canonicalModelId,
        payload.correlationId,
        target.targetId,
      );
    }
  }

  private buildCompletionUsageEvent(
    payload: GatewayDispatchPayload,
    target: ResolvedTargetDto,
    completion: NormalizedCompletionData,
  ): UsageEvent {
    if (!payload.tenantId)
      throw new InternalGatewayError(
        payload.canonicalModelId,
        payload.correlationId,
        'Tenant context is required for usage accounting',
      );
    return {
      eventId: `usage_${completion.completionId}`,
      schemaVersion: '1.0.0',
      tenantId: payload.tenantId,
      userId: payload.userId,
      actorId: payload.actorId,
      productId: 'billy',
      sourceService: 'model-gateway',
      operation: 'model.completion',
      resourceId: payload.canonicalModelId,
      measurements: {
        'tokens.input': completion.usage.promptTokens,
        'tokens.output': completion.usage.completionTokens,
        'tokens.total': completion.usage.totalTokens,
        'units.requests': 1,
      },
      dimensions: {
        provider: target.provider,
        targetId: target.targetId,
        finishReason: completion.finishReason,
        usageSource: completion.usage.usageSource ?? 'unknown',
      },
      lineage: {
        correlationId: payload.correlationId,
        requestId: payload.requestId,
        sessionId: payload.conversationId,
      },
      idempotencyKey: `model.completion:${completion.completionId}`,
      occurredAt: new Date().toISOString(),
    };
  }

  /**
   * Captures a failed/cancelled/interrupted attempt for accounting. Bounded
   * and best-effort: the provider call already failed, so a capture failure
   * here is swallowed rather than masking the original provider error.
   *
   * Token counts are recorded ONLY when the provider actually reported them
   * (`knownUsage.usageSource === 'provider'`); otherwise the event carries
   * no token keys at all plus `usageSource: 'unknown'`, so genuinely
   * reported zero tokens are distinguishable from unavailable usage and no
   * counts are ever invented.
   */
  private async captureFailedAttemptUsageBounded(
    payload: GatewayDispatchPayload,
    target: ResolvedTargetDto,
    completionId: string,
    outcome: string,
    knownUsage?: TokenUsage | undefined,
  ): Promise<void> {
    if (!this.meteringCapture) return;
    const event = this.buildAttemptUsageEvent(payload, target, completionId, outcome, knownUsage);
    if (!event) return;
    try {
      await this.meteringCapture.capture(event, { timeoutMs: this.meteringCaptureTimeoutMs });
    } catch {
      // The provider request already failed. Metering cleanup is best effort
      // and bounded; it must never mask the original provider error.
    }
  }

  private buildAttemptUsageEvent(
    payload: GatewayDispatchPayload,
    target: ResolvedTargetDto,
    completionId: string,
    outcome: string,
    knownUsage?: TokenUsage | undefined,
  ): UsageEvent | null {
    if (!payload.tenantId) return null;
    // Only provider-confirmed counts are recorded. A reported zero is kept
    // (genuinely confirmed); anything else omits token keys entirely.
    const confirmed = knownUsage?.usageSource === 'provider' ? knownUsage : undefined;
    return {
      eventId: `usage_${completionId}`,
      schemaVersion: '1.0.0',
      tenantId: payload.tenantId,
      userId: payload.userId,
      actorId: payload.actorId,
      productId: 'billy',
      sourceService: 'model-gateway',
      operation: 'model.completion',
      resourceId: payload.canonicalModelId,
      measurements: confirmed
        ? {
            'tokens.input': confirmed.promptTokens,
            'tokens.output': confirmed.completionTokens,
            'tokens.total': confirmed.totalTokens,
            'units.requests': 1,
          }
        : {
            'units.requests': 1,
          },
      dimensions: {
        provider: target.provider,
        targetId: target.targetId,
        outcome,
        usageSource: confirmed ? 'provider' : 'unknown',
      },
      lineage: {
        correlationId: payload.correlationId,
        requestId: payload.requestId,
        sessionId: payload.conversationId,
      },
      idempotencyKey: `model.completion:${completionId}`,
      occurredAt: new Date().toISOString(),
    };
  }
}
