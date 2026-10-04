import { describe, it, expect } from 'vitest';
import {
  NoopAiSpan,
  NoopAiTracer,
  NoopAiMetricsRecorder,
  type GenAiSpanAttributes,
} from './index.js';

describe('@oicunt-ai/observability', () => {
  it('instantiates NoopAiSpan without throwing', () => {
    const span = new NoopAiSpan();
    expect(span.context().traceId).toBe('00000000000000000000000000000000');

    expect(() => {
      span.setAttribute('test', 'value');
      span.setAttributes({ count: 1 });
      span.setGenAiAttributes({ 'gen_ai.system': 'anthropic' });
      span.setStatus('ok');
      span.end();
    }).not.toThrow();
  });

  it('runs NoopAiTracer withSpan callback correctly', async () => {
    const tracer = new NoopAiTracer();
    const result = await tracer.withSpan('test-span', async (span) => {
      span.setAttribute('inner', true);
      return 42;
    });
    expect(result).toBe(42);
  });

  it('allows recording metrics using NoopAiMetricsRecorder without throwing', () => {
    const recorder = new NoopAiMetricsRecorder();
    expect(() => {
      recorder.recordTokenUsage('oicunt.model.general', {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      recorder.recordInferenceDuration('oicunt.model.general', 250);
      recorder.recordEstimatedCost('oicunt.model.general', 0.0001);
      recorder.recordToolExecution('calculator', 10, true);
    }).not.toThrow();
  });

  it('validates GenAiSpanAttributes type compatibility', () => {
    const attrs: GenAiSpanAttributes = {
      'gen_ai.system': 'anthropic',
      'gen_ai.request.model': 'claude-3-5-sonnet',
      'gen_ai.usage.input_tokens': 150,
      'gen_ai.usage.output_tokens': 50,
      'oicunt.canonical_model': 'oicunt.model.general',
      'oicunt.correlation_id': 'corr-abc-123',
    };
    expect(attrs['gen_ai.system']).toBe('anthropic');
    expect(attrs['oicunt.canonical_model']).toBe('oicunt.model.general');
  });
});
