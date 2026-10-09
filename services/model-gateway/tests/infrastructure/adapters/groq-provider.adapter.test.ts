import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@oicunt-ai/ai-types';
import type { ResolvedTargetDto } from '../../../src/application/dtos/dispatch.dto.js';
import type { ProviderExecutionRequest } from '../../../src/application/ports/provider-adapter.port.js';
import {
  ContentPolicyViolationError,
  ContextWindowExceededError,
  ModelUnavailableError,
  ProviderAuthenticationError,
  RateLimitExceededError,
  RequestCancelledError,
} from '../../../src/domain/errors.js';
import { GroqProviderAdapter } from '../../../src/infrastructure/adapters/groq/groq-provider.adapter.js';
import { loadModelGatewayConfig } from '../../../src/config.js';
import { ModelGatewayService } from '../../../src/service.js';
import { InMemoryAdapterRegistry } from '../../../src/infrastructure/adapters/in-memory-adapter-registry.js';
import { InMemoryCircuitBreakerStore } from '../../../src/infrastructure/circuit-breaker/in-memory-circuit-breaker-store.js';
import type { UsagePublisherPort } from '../../../src/application/ports/usage-publisher.port.js';
import { DispatchModelUseCase } from '../../../src/application/use-cases/dispatch-model.use-case.js';

describe('GroqProviderAdapter', () => {
  const originalFetch = globalThis.fetch;
  const originalGroqKey = process.env['GROQ_API_KEY'];

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env['GROQ_API_KEY'];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalGroqKey === undefined) delete process.env['GROQ_API_KEY'];
    else process.env['GROQ_API_KEY'] = originalGroqKey;
  });

  function createTarget(overrides: Partial<ResolvedTargetDto> = {}): ResolvedTargetDto {
    return {
      targetId: 'target-groq-gpt-oss',
      provider: 'groq',
      upstreamModelId: 'openai/gpt-oss-20b',
      priority: 1,
      weight: 100,
      supportsStreaming: true,
      ...overrides,
    };
  }

  function createRequest(
    options: {
      messages?: readonly ChatMessage[];
      parameters?: Record<string, unknown>;
      effort?: string;
      signal?: AbortSignal;
    } = {},
  ): ProviderExecutionRequest {
    const controller = new AbortController();
    const target = createTarget();
    return {
      requestId: 'req-uuid-1',
      correlationId: 'corr-uuid-1',
      completionId: 'comp-uuid-1',
      attemptTimeoutMs: 15000,
      cancellationSignal: options.signal ?? controller.signal,
      target,
      payload: {
        requestId: 'req-uuid-1',
        correlationId: 'corr-uuid-1',
        canonicalModelId: 'oicunt.model.groq-gpt-oss-20b',
        version: 'v1.0.0',
        stream: false,
        messages: options.messages ?? [{ role: 'user', content: 'Hello Groq' }],
        parameters: options.parameters ?? { maxTokens: 1024, temperature: 0.5 },
        effort: options.effort as 'low' | undefined,
        limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
        pricing: { costPerMillionInputTokens: 0.5, costPerMillionOutputTokens: 0.75 },
        eligibleTargets: [target],
        routingPolicy: {
          strategy: 'priority-fallback',
          maxFallbackAttempts: 1,
          requireHealthyTarget: true,
          degradationBehavior: 'fail-fast',
        },
        actorId: 'test-actor',
      },
    };
  }

  function mockFetchOnce(body: unknown, init: { status?: number } = {}): void {
    globalThis.fetch = vi.fn(async () => {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      return new Response(payload, {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  }

  const successBody = {
    id: 'chatcmpl-groq-1',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Hello from Groq',
          reasoning: 'Considering the greeting',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 18,
      completion_tokens: 10,
      total_tokens: 28,
      completion_tokens_details: { reasoning_tokens: 5 },
      prompt_tokens_details: { cached_tokens: 2 },
    },
  };

  it('executes a unary completion and normalizes model, messages, and usage', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(successBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const adapter = new GroqProviderAdapter({ apiKey: 'test-groq-key' });
    expect(adapter.provider).toBe('groq');
    const result = await adapter.executeUnary(createRequest());

    expect(capturedUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(capturedHeaders['authorization']).toBe('Bearer test-groq-key');
    expect(capturedBody['model']).toBe('openai/gpt-oss-20b');
    expect(capturedBody['messages']).toEqual([{ role: 'user', content: 'Hello Groq' }]);
    expect(capturedBody['max_tokens']).toBe(1024);
    expect(capturedBody['temperature']).toBe(0.5);

    expect(result.completionId).toBe('comp-uuid-1');
    expect(result.model).toBe('oicunt.model.groq-gpt-oss-20b');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toMatchObject({
      promptTokens: 18,
      completionTokens: 10,
      totalTokens: 28,
      reasoningTokens: 5,
      cachedTokens: 2,
    });
    // Reasoning is preserved as thinking parts; the gateway filters them unless opted in.
    expect(result.message.content).toEqual([
      { type: 'thinking', thinking: 'Considering the greeting' },
      { type: 'text', text: 'Hello from Groq' },
    ]);
  });

  it('forwards the effort hint as reasoning_effort when present', async () => {
    let capturedBody: Record<string, unknown> = {};
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(successBody), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new GroqProviderAdapter({ apiKey: 'test-groq-key' });
    await adapter.executeUnary(createRequest({ effort: 'low' }));
    expect(capturedBody['reasoning_effort']).toBe('low');
  });

  it('reads the API key from GROQ_API_KEY and reports health accordingly', async () => {
    process.env['GROQ_API_KEY'] = 'env-groq-key';
    const fromEnv = new GroqProviderAdapter();
    expect(await fromEnv.healthCheck(createTarget())).toBe(true);

    const missing = new GroqProviderAdapter({ apiKey: '' });
    expect(await missing.healthCheck(createTarget())).toBe(false);
    await expect(missing.executeUnary(createRequest())).rejects.toBeInstanceOf(
      ProviderAuthenticationError,
    );
  });

  it('maps 401 to ProviderAuthenticationError without leaking the key', async () => {
    mockFetchOnce(
      { error: { message: 'Invalid API Key', type: 'authentication_error' } },
      { status: 401 },
    );
    const adapter = new GroqProviderAdapter({ apiKey: 'bad-key' });
    const failure = await adapter.executeUnary(createRequest()).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(ProviderAuthenticationError);
    expect(String((failure as Error).message)).not.toContain('bad-key');
  });

  it('maps 429 to RateLimitExceededError', async () => {
    mockFetchOnce(
      { error: { message: 'Rate limit reached', type: 'rate_limit_error' } },
      { status: 429 },
    );
    const adapter = new GroqProviderAdapter({ apiKey: 'k' });
    await expect(adapter.executeUnary(createRequest())).rejects.toBeInstanceOf(
      RateLimitExceededError,
    );
  });

  it('maps context overages to ContextWindowExceededError and policy hits to ContentPolicyViolationError', async () => {
    const adapter = new GroqProviderAdapter({ apiKey: 'k' });
    mockFetchOnce(
      {
        error: { message: 'Request exceeds maximum context length', type: 'invalid_request_error' },
      },
      { status: 400 },
    );
    await expect(adapter.executeUnary(createRequest())).rejects.toBeInstanceOf(
      ContextWindowExceededError,
    );
    mockFetchOnce(
      { error: { message: 'Flagged by content moderation', type: 'invalid_request_error' } },
      { status: 400 },
    );
    await expect(adapter.executeUnary(createRequest())).rejects.toBeInstanceOf(
      ContentPolicyViolationError,
    );
  });

  it('maps outages and malformed responses to ModelUnavailableError', async () => {
    const adapter = new GroqProviderAdapter({ apiKey: 'k' });
    mockFetchOnce(
      { error: { message: 'Service unavailable', type: 'server_error' } },
      { status: 503 },
    );
    await expect(adapter.executeUnary(createRequest())).rejects.toBeInstanceOf(
      ModelUnavailableError,
    );
    mockFetchOnce('not-json{{', { status: 200 });
    await expect(adapter.executeUnary(createRequest())).rejects.toBeInstanceOf(
      ModelUnavailableError,
    );
    mockFetchOnce({ id: 'x', choices: [] }, { status: 200 });
    await expect(adapter.executeUnary(createRequest())).rejects.toBeInstanceOf(
      ModelUnavailableError,
    );
  });

  it('aborts unary execution when the cancellation signal fires', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    const adapter = new GroqProviderAdapter({ apiKey: 'k' });
    await expect(
      adapter.executeUnary(createRequest({ signal: controller.signal })),
    ).rejects.toBeInstanceOf(RequestCancelledError);
  });

  function mockStreamSse(frames: string[]): void {
    const text = frames.join('');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    });
    globalThis.fetch = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;
  }

  it('streams tokens, thinking, and a terminal finish with usage', async () => {
    mockStreamSse([
      'data: {"choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"reasoning":"step one"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,"completion_tokens":10,"total_tokens":28,"completion_tokens_details":{"reasoning_tokens":4}}}\n\n',
      'data: [DONE]\n\n',
    ]);

    const adapter = new GroqProviderAdapter({ apiKey: 'k' });
    const events = [];
    for await (const event of adapter.executeStream(createRequest())) {
      events.push(event);
    }

    expect(events.map((event) => event.event)).toEqual(['token', 'thinking', 'token', 'finish']);
    const finish = events[3];
    expect(finish?.event).toBe('finish');
    if (finish?.event === 'finish') {
      expect(finish.data.finishReason).toBe('stop');
      expect(finish.data.usage).toMatchObject({
        promptTokens: 18,
        completionTokens: 10,
        totalTokens: 28,
        reasoningTokens: 4,
      });
    }
  });

  it('ends with zeroed usage when the stream supplies none and skips malformed lines', async () => {
    mockStreamSse([
      'data: {"choices":[{"index":0,"delta":{"content":"Hi"}}]}\n\n',
      'data: not-json\n\n',
      '\n',
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}\n\n',
    ]);

    const adapter = new GroqProviderAdapter({ apiKey: 'k' });
    const events = [];
    for await (const event of adapter.executeStream(createRequest())) {
      events.push(event);
    }
    expect(events.map((event) => event.event)).toEqual(['token', 'finish']);
    const finish = events[1];
    if (finish?.event === 'finish') {
      expect(finish.data.finishReason).toBe('length');
      expect(finish.data.usage).toMatchObject({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    }
  });

  it('aborts streaming when the cancellation signal fires', async () => {
    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    const adapter = new GroqProviderAdapter({ apiKey: 'k' });
    await expect(async () => {
      for await (const _event of adapter.executeStream(
        createRequest({ signal: controller.signal }),
      )) {
        // consume
      }
    }).rejects.toBeInstanceOf(RequestCancelledError);
  });

  it('registers the adapter from service configuration only when a key is present', async () => {
    const withKey = new ModelGatewayService({
      config: loadModelGatewayConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        groq: { apiKey: 'service-groq-key' },
      }),
    });
    expect(withKey.getAdapterRegistry().getAdapter('groq')).toBeDefined();

    const withoutKey = new ModelGatewayService({
      config: loadModelGatewayConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        groq: { apiKey: '' },
      }),
    });
    expect(withoutKey.getAdapterRegistry().getAdapter('groq')).toBeUndefined();
  });

  it('routes a groq target through DispatchModelUseCase and publishes usage', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify(successBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const groqAdapter = new GroqProviderAdapter({ apiKey: 'k' });
    const registry = new InMemoryAdapterRegistry([groqAdapter]);
    const published: { idempotencyKey: string; tenantId: string }[] = [];
    const stubPublisher: UsagePublisherPort = {
      start: async () => {},
      isReady: () => true,
      close: async () => {},
      publish: async (event) => {
        published.push({ idempotencyKey: event.idempotencyKey, tenantId: event.tenantId });
      },
    };
    const useCase = new DispatchModelUseCase({
      adapterRegistry: registry,
      circuitBreakerStore: new InMemoryCircuitBreakerStore(),
      usagePublisher: stubPublisher,
    });

    const target = createTarget();
    const result = await useCase.executeUnary({
      requestId: 'req-route-1',
      correlationId: 'corr-route-1',
      canonicalModelId: 'oicunt.model.groq-gpt-oss-20b',
      version: 'v1.0.0',
      stream: false,
      messages: [{ role: 'user', content: 'Route me' }],
      limits: { contextWindowTokens: 128000, maxOutputTokens: 4096 },
      pricing: { costPerMillionInputTokens: 0.5, costPerMillionOutputTokens: 0.75 },
      eligibleTargets: [target],
      routingPolicy: {
        strategy: 'priority-fallback',
        maxFallbackAttempts: 1,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      tenantId: 'tenant-route',
      actorId: 'actor-route',
    });

    expect(result.model).toBe('oicunt.model.groq-gpt-oss-20b');
    expect(result.finishReason).toBe('stop');
    expect(published).toHaveLength(1);
    expect(published[0]?.tenantId).toBe('tenant-route');
    expect(published[0]?.idempotencyKey.startsWith('model.completion:')).toBe(true);
  });
});
