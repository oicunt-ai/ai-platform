import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@oicunt-ai/ai-types';
import type { ResolvedTargetDto } from '../../../src/application/dtos/dispatch.dto.js';
import type { ProviderExecutionRequest } from '../../../src/application/ports/provider-adapter.port.js';
import {
  ContextWindowExceededError,
  ModelUnavailableError,
  ProviderAuthenticationError,
  RateLimitExceededError,
  RequestCancelledError,
  UnsupportedCapabilityError,
} from '../../../src/domain/errors.js';
import { AnthropicProviderAdapter } from '../../../src/infrastructure/adapters/anthropic/anthropic-provider.adapter.js';

describe('AnthropicProviderAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createTarget(overrides: Partial<ResolvedTargetDto> = {}): ResolvedTargetDto {
    return {
      targetId: 'target-anthropic-sonnet',
      provider: 'anthropic',
      upstreamModelId: 'claude-3-5-sonnet-20241022',
      priority: 1,
      weight: 100,
      supportsStreaming: false,
      ...overrides,
    };
  }

  function createRequest(
    options: {
      messages?: readonly ChatMessage[];
      apiKey?: string;
      signal?: AbortSignal;
      parameters?: Record<string, unknown>;
    } = {},
  ): ProviderExecutionRequest {
    const controller = new AbortController();
    const signal = options.signal ?? controller.signal;
    const target = createTarget({
      adapterOptions: options.apiKey !== undefined ? { apiKey: options.apiKey } : undefined,
    });

    return {
      requestId: 'req-uuid-1',
      correlationId: 'corr-uuid-1',
      completionId: 'comp-uuid-1',
      attemptTimeoutMs: 15000,
      cancellationSignal: signal,
      target,
      payload: {
        requestId: 'req-uuid-1',
        correlationId: 'corr-uuid-1',
        canonicalModelId: 'claude-sonnet',
        version: '1.0.0',
        stream: false,
        messages: options.messages ?? [
          { role: 'system', content: 'You are a helpful coding assistant.' },
          { role: 'user', content: 'Write a quicksort in TypeScript.' },
        ],
        parameters: options.parameters ?? {
          maxTokens: 2048,
          temperature: 0.2,
          topP: 0.9,
          stopSequences: ['```'],
        },
        limits: { contextWindowTokens: 200000, maxOutputTokens: 8192 },
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

  it('normalizes a successful Anthropic Messages API completion', async () => {
    const mockAnthropicResponse = {
      id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Here is a quicksort implementation...',
        },
      ],
      model: 'claude-3-5-sonnet-20241022',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 45,
        output_tokens: 120,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 10,
      },
    };

    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;

      return new Response(JSON.stringify(mockAnthropicResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test-key' });
    const request = createRequest();

    const result = await adapter.executeUnary(request);

    // Verify wire protocol call
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(capturedHeaders['x-api-key']).toBe('sk-ant-test-key');
    expect(capturedHeaders['anthropic-version']).toBe('2023-06-01');
    expect(capturedHeaders['x-correlation-id']).toBe('corr-uuid-1');

    // Verify system instruction separation
    expect(capturedBody['system']).toBe('You are a helpful coding assistant.');
    expect(capturedBody['model']).toBe('claude-3-5-sonnet-20241022');
    expect(capturedBody['max_tokens']).toBe(2048);
    expect(capturedBody['temperature']).toBe(0.2);
    expect(capturedBody['top_p']).toBe(0.9);
    expect(capturedBody['stop_sequences']).toEqual(['```']);
    expect(capturedBody['messages']).toEqual([
      { role: 'user', content: 'Write a quicksort in TypeScript.' },
    ]);

    // Verify normalized output contract
    expect(result.completionId).toBe('comp-uuid-1');
    expect(result.model).toBe('claude-sonnet');
    expect(result.finishReason).toBe('stop');
    expect(result.message.role).toBe('assistant');
    expect(result.message.content).toBe('Here is a quicksort implementation...');
    expect(result.usage.promptTokens).toBe(45);
    expect(result.usage.completionTokens).toBe(120);
    expect(result.usage.totalTokens).toBe(165);
    expect(result.usage.cachedTokens).toBe(10);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('normalizes max_tokens stop reason to length', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_02',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Truncated output' }],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'max_tokens',
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const result = await adapter.executeUnary(createRequest());
    expect(result.finishReason).toBe('length');
  });

  it('normalizes tool_use stop reason to tool_calls', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_03',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Calling tool' }],
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const result = await adapter.executeUnary(createRequest());
    expect(result.finishReason).toBe('tool_calls');
  });

  it('fails with ProviderAuthenticationError when no API key is provided', async () => {
    const adapter = new AnthropicProviderAdapter({ apiKey: undefined });
    delete process.env['ANTHROPIC_API_KEY'];

    const request = createRequest({ apiKey: '' });
    await expect(adapter.executeUnary(request)).rejects.toThrow(ProviderAuthenticationError);
  });

  it('maps HTTP 401/403 to ProviderAuthenticationError without leaking raw credentials', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'invalid x-api-key token: sk-ant-secret-12345',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const promise = adapter.executeUnary(createRequest());

    await expect(promise).rejects.toThrow(ProviderAuthenticationError);
    await expect(promise).rejects.toSatisfy((err: unknown) => {
      const error = err as ProviderAuthenticationError;
      return (
        error.code === 'PROVIDER_AUTHENTICATION_ERROR' &&
        !error.message.includes('sk-ant-secret') &&
        error.statusCode === 500 &&
        error.retryable === false
      );
    });
  });

  it('maps HTTP 429 to RateLimitExceededError as retryable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Number of request tokens per minute has been exceeded.',
          },
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const promise = adapter.executeUnary(createRequest());

    await expect(promise).rejects.toThrow(RateLimitExceededError);
    await expect(promise).rejects.toSatisfy((err: unknown) => {
      const error = err as RateLimitExceededError;
      return (
        error.code === 'RATE_LIMIT_EXCEEDED' && error.statusCode === 429 && error.retryable === true
      );
    });
  });

  it('maps HTTP 529 and 503 to ModelUnavailableError as retryable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'overloaded_error',
            message: 'Anthropic Claude is temporarily overloaded.',
          },
        }),
        { status: 529, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const promise = adapter.executeUnary(createRequest());

    await expect(promise).rejects.toThrow(ModelUnavailableError);
    await expect(promise).rejects.toSatisfy((err: unknown) => {
      const error = err as ModelUnavailableError;
      return (
        error.code === 'MODEL_UNAVAILABLE' && error.statusCode === 503 && error.retryable === true
      );
    });
  });

  it('maps HTTP 400 context length exceeded to ContextWindowExceededError as non-retryable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message:
              'Prompt is too long: prompt tokens 210000 exceeds maximum context length of 200000',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const promise = adapter.executeUnary(createRequest());

    await expect(promise).rejects.toThrow(ContextWindowExceededError);
    await expect(promise).rejects.toSatisfy((err: unknown) => {
      const error = err as ContextWindowExceededError;
      return (
        error.code === 'CONTEXT_WINDOW_EXCEEDED' &&
        error.statusCode === 400 &&
        error.retryable === false
      );
    });
  });

  it('throws RequestCancelledError when cancellationSignal is aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Caller cancelled'));

    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const request = createRequest({ signal: controller.signal });

    await expect(adapter.executeUnary(request)).rejects.toThrow(RequestCancelledError);
  });

  it('throws UnsupportedCapabilityError for streaming in Step 3', async () => {
    const adapter = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    const request = createRequest();

    const stream = adapter.executeStream(request);
    await expect(async () => {
      for await (const _ of stream) {
        // should throw immediately
      }
    }).rejects.toThrow(UnsupportedCapabilityError);
  });

  it('reports healthy when API key is configured', async () => {
    const adapterWithKey = new AnthropicProviderAdapter({ apiKey: 'sk-ant-test' });
    expect(await adapterWithKey.healthCheck(createTarget())).toBe(true);

    const adapterWithoutKey = new AnthropicProviderAdapter({ apiKey: undefined });
    delete process.env['ANTHROPIC_API_KEY'];
    expect(await adapterWithoutKey.healthCheck(createTarget())).toBe(false);
  });
});
