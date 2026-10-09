import type { TokenUsage } from '@oicunt-ai/model-types';

/**
 * OpenTelemetry GenAI semantic convention attributes.
 */
export interface GenAiSpanAttributes {
  /** The generative AI product/vendor or framework name (e.g. 'test-provider', 'openai') */
  readonly 'gen_ai.system'?: string;
  /** The model identifier requested by the client */
  readonly 'gen_ai.request.model'?: string;
  /** The temperature requested */
  readonly 'gen_ai.request.temperature'?: number;
  /** The top_p parameter */
  readonly 'gen_ai.request.top_p'?: number;
  /** Maximum tokens requested */
  readonly 'gen_ai.request.max_tokens'?: number;
  /** Number of input/prompt tokens consumed */
  readonly 'gen_ai.usage.input_tokens'?: number;
  /** Number of output/completion tokens consumed */
  readonly 'gen_ai.usage.output_tokens'?: number;
  /** Reasons why the model stopped generating */
  readonly 'gen_ai.response.finish_reasons'?: readonly string[];
  /** Upstream completion ID */
  readonly 'gen_ai.response.id'?: string;
  /** Canonical model ID mapped within the platform */
  readonly 'oicunt.canonical_model'?: string;
  /** Correlation identifier across distributed calls */
  readonly 'oicunt.correlation_id'?: string;
}

export type SpanStatus = 'ok' | 'error' | 'unset';

export interface AiSpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags?: number;
}

/**
 * Span abstraction for AI operations.
 */
export interface AiSpan {
  context(): AiSpanContext;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attributes: Record<string, string | number | boolean | readonly string[]>): void;
  setGenAiAttributes(attributes: GenAiSpanAttributes): void;
  setStatus(status: SpanStatus, description?: string): void;
  end(): void;
}

/**
 * Distributed tracer for AI service spans.
 */
export interface AiTracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): AiSpan;
  withSpan<T>(name: string, fn: (span: AiSpan) => Promise<T>): Promise<T>;
}

/**
 * Metrics recorder for AI operations.
 */
export interface AiMetricsRecorder {
  recordTokenUsage(model: string, usage: TokenUsage, attributes?: Record<string, string>): void;
  recordInferenceDuration(
    model: string,
    durationMs: number,
    attributes?: Record<string, string>,
  ): void;
  recordEstimatedCost(model: string, costUsd: number, attributes?: Record<string, string>): void;
  recordToolExecution(toolName: string, durationMs: number, success: boolean): void;
}

/**
 * No-op span implementation for fallback or tests.
 */
export class NoopAiSpan implements AiSpan {
  private readonly spanContext: AiSpanContext = {
    traceId: '00000000000000000000000000000000',
    spanId: '0000000000000000',
  };

  context(): AiSpanContext {
    return this.spanContext;
  }

  setAttribute(_key: string, _value: string | number | boolean): void {}
  setAttributes(_attributes: Record<string, string | number | boolean | readonly string[]>): void {}
  setGenAiAttributes(_attributes: GenAiSpanAttributes): void {}
  setStatus(_status: SpanStatus, _description?: string): void {}
  end(): void {}
}

/**
 * No-op tracer implementation.
 */
export class NoopAiTracer implements AiTracer {
  private readonly defaultSpan = new NoopAiSpan();

  startSpan(_name: string, _attributes?: Record<string, string | number | boolean>): AiSpan {
    return this.defaultSpan;
  }

  async withSpan<T>(_name: string, fn: (span: AiSpan) => Promise<T>): Promise<T> {
    return fn(this.defaultSpan);
  }
}

/**
 * No-op metrics recorder implementation.
 */
export class NoopAiMetricsRecorder implements AiMetricsRecorder {
  recordTokenUsage(
    _model: string,
    _usage: TokenUsage,
    _attributes?: Record<string, string>,
  ): void {}
  recordInferenceDuration(
    _model: string,
    _durationMs: number,
    _attributes?: Record<string, string>,
  ): void {}
  recordEstimatedCost(
    _model: string,
    _costUsd: number,
    _attributes?: Record<string, string>,
  ): void {}
  recordToolExecution(_toolName: string, _durationMs: number, _success: boolean): void {}
}
