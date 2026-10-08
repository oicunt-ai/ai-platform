import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ModelRegistryService } from '@oicunt-ai/service-model-registry';
import { loadModelRegistryConfig } from '../../services/model-registry/src/config.js';
import { ModelGatewayService } from '@oicunt-ai/service-model-gateway';
import { loadModelGatewayConfig } from '../../services/model-gateway/src/config.js';
import { InferenceService } from '@oicunt-ai/service-inference';
import { loadInferenceConfig } from '../../services/inference/src/config.js';
import { AiOrchestratorService } from '@oicunt-ai/service-ai-orchestrator';
import { loadAiOrchestratorConfig } from '../../services/ai-orchestrator/src/config.js';
import type { GatewayDispatchPayload } from '../../services/inference/src/application/ports/model-gateway.port.js';
import type { InferenceExecutionRequest } from '../../services/inference/src/application/dtos/inference-execution.dto.js';
import type { OrchestratorChatRequest } from '../../services/ai-orchestrator/src/application/dtos/chat.dto.js';

function createMockAnthropicStreamServer(
  options: {
    delayMs?: number;
    tokens?: string[];
    inputTokens?: number;
    outputTokens?: number;
  } = {},
) {
  let capturedHeaders: http.IncomingHttpHeaders | null = null;
  let capturedBody: Record<string, unknown> | null = null;
  let clientAborted = false;

  const tokens = options.tokens ?? ['Quantum', ' computing', ' leverages', ' superposition.'];
  const inputTokens = options.inputTokens ?? 18;
  const outputTokens = options.outputTokens ?? tokens.length * 2;

  const server = http.createServer((req, res) => {
    capturedHeaders = req.headers;
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });

    req.on('close', () => {
      clientAborted = true;
      if (!res.writableEnded) {
        res.end();
      }
    });

    req.on('end', async () => {
      try {
        capturedBody = JSON.parse(data) as Record<string, unknown>;
      } catch {
        capturedBody = null;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      // 1. message_start
      res.write(
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: 'msg_stream_e2e_01',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: inputTokens, output_tokens: 1 },
          },
        })}\n\n`,
      );

      // 2. content_block_start
      res.write(
        `event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n\n`,
      );

      // 3. content_block_delta for each token
      for (let i = 0; i < tokens.length; i++) {
        if (options.delayMs) {
          await new Promise((r) => setTimeout(r, options.delayMs));
        }
        if (clientAborted || res.writableEnded) {
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }

        res.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: tokens[i] },
          })}\n\n`,
        );
      }

      // 4. content_block_stop
      res.write(
        `event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0,
        })}\n\n`,
      );

      // 5. message_delta
      res.write(
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: outputTokens },
        })}\n\n`,
      );

      // 6. message_stop
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);

      if (!res.writableEnded) {
        res.end();
      }
    });
  });

  return {
    server,
    getCapturedHeaders: () => capturedHeaders,
    getCapturedBody: () => capturedBody,
    wasAborted: () => clientAborted,
  };
}

async function consumeSseStream(response: Response): Promise<{
  events: Array<{ event: string; data: any }>;
  text: string;
}> {
  const events: Array<{ event: string; data: any }> = [];
  let text = '';

  if (!response.body) {
    return { events, text };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    let currentEvent = 'message';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(dataStr);
          events.push({ event: currentEvent, data: parsed });
          if (currentEvent === 'token' && typeof parsed.delta === 'string') {
            text += parsed.delta;
          }
        } catch {
          // ignore non-json
        }
      }
    }
  }

  return { events, text };
}

describe('OICUNT AI Step 5 - Streaming E2E', () => {
  let mockServer: http.Server | null = null;
  let mockPort: number;
  let modelRegistryService: ModelRegistryService | null = null;
  let modelGatewayService: ModelGatewayService | null = null;
  let inferenceService: InferenceService | null = null;
  let orchestratorService: AiOrchestratorService | null = null;
  let gatewayService: any = null;

  let registryPort: number;
  let gatewayPort: number;
  let inferencePort: number;
  let orchestratorPort: number;
  let platformGatewayPort: number;

  beforeEach(() => {
    mockServer = null;
    modelRegistryService = null;
    modelGatewayService = null;
    inferenceService = null;
    orchestratorService = null;
    gatewayService = null;
  });

  afterEach(async () => {
    if (gatewayService) {
      await gatewayService.stop();
      gatewayService = null;
    }
    if (orchestratorService) {
      await orchestratorService.stop();
      orchestratorService = null;
    }
    if (inferenceService) {
      await inferenceService.stop();
      inferenceService = null;
    }
    if (modelGatewayService) {
      await modelGatewayService.stop();
      modelGatewayService = null;
    }
    if (modelRegistryService) {
      await modelRegistryService.stop();
      modelRegistryService = null;
    }
    if (mockServer) {
      await new Promise<void>((resolve) => {
        mockServer!.close(() => resolve());
      });
      mockServer = null;
    }
  });

  it('1. proves model resolution -> inference streaming execution', async () => {
    // 1. Start Model Registry with auto-seeded claude-sonnet
    const registryConfig = loadModelRegistryConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      autoSeedRealModel: true,
    });
    modelRegistryService = new ModelRegistryService({ config: registryConfig });
    registryPort = await modelRegistryService.start();

    // 2. Mock Inference Port to capture what Orchestrator resolves and streams
    let receivedInferenceRequest: any = null;
    const fakeInferencePort = {
      async *executeStream(req: any) {
        receivedInferenceRequest = req;
        yield { event: 'token' as const, data: { delta: 'Resolved and streamed' } };
        yield {
          event: 'finish' as const,
          data: {
            finishReason: 'stop' as const,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          },
        };
      },
      async checkHealth() {
        return true;
      },
    };

    // 3. Start AI Orchestrator connected to Model Registry
    const orchestratorConfig = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      modelRegistryBaseUrl: `http://127.0.0.1:${registryPort}`,
      memoryBaseUrl: 'in-memory',
    });
    orchestratorService = new AiOrchestratorService({
      config: orchestratorConfig,
      inference: fakeInferencePort as any,
    });
    orchestratorPort = await orchestratorService.start();

    // 4. Send chat turn requesting 'claude-sonnet' with stream: true
    const chatReq: OrchestratorChatRequest = {
      model: 'claude-sonnet',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      conversationId: 'conv-res-stream-1',
      stream: true,
    };

    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Request-ID': 'req-res-stream-1',
        'X-Correlation-ID': 'corr-res-stream-1',
        'X-User-ID': 'user-1',
        'X-Tenant-ID': 'tenant-1',
        'X-Service-Name': 'api-gateway',
      },
      body: JSON.stringify(chatReq),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const { events, text } = await consumeSseStream(res);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(text).toBe('Resolved and streamed');

    // Verify model resolution drove inference streaming execution
    expect(receivedInferenceRequest).toBeDefined();
    expect(receivedInferenceRequest.canonicalModelId).toBe('claude-sonnet');
    expect(receivedInferenceRequest.version).toBe('v1.0.0');
    expect(receivedInferenceRequest.stream).toBe(true);
    expect(receivedInferenceRequest.eligibleTargets).toBeDefined();
    expect(receivedInferenceRequest.eligibleTargets).toHaveLength(1);
    expect(receivedInferenceRequest.eligibleTargets[0].provider).toBe('anthropic');
    expect(receivedInferenceRequest.eligibleTargets[0].upstreamModelId).toBe(
      'claude-3-5-sonnet-20241022',
    );
    expect(receivedInferenceRequest.eligibleTargets[0].supportsStreaming).toBe(true);
    expect(receivedInferenceRequest.routingPolicy.strategy).toBe('priority-fallback');
  });

  it('2. proves inference -> model gateway streaming', async () => {
    // 1. Mock Model Gateway Service
    let streamPayloadCaptured: GatewayDispatchPayload | undefined = undefined;
    const fakeGatewayPort = {
      async *dispatchStream(payload: GatewayDispatchPayload) {
        streamPayloadCaptured = payload;
        yield { event: 'token' as const, data: { delta: 'Gateway' } };
        yield { event: 'token' as const, data: { delta: ' streaming' } };
        yield {
          event: 'finish' as const,
          data: {
            finishReason: 'stop' as const,
            usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
          },
        };
      },
      async checkHealth() {
        return true;
      },
    };

    const inferenceConfig = loadInferenceConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
    });
    inferenceService = new InferenceService({
      config: inferenceConfig,
      modelGateway: fakeGatewayPort as any,
    });
    inferencePort = await inferenceService.start();

    const inferenceReq: InferenceExecutionRequest = {
      requestId: 'req-inf-gw-s1',
      correlationId: 'corr-inf-gw-s1',
      actorId: 'usr-inf-gw-s1',
      stream: true,
      canonicalModelId: 'claude-sonnet',
      version: 'v1.0.0',
      messages: [{ role: 'user', content: 'Stream test' }],
      limits: { contextWindowTokens: 200000, maxOutputTokens: 8192 },
      deadlineMs: Date.now() + 60000,
    };

    const res = await fetch(`http://127.0.0.1:${inferencePort}/internal/v1/inference/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Request-ID': 'req-inf-gw-s1',
        'X-Correlation-ID': 'corr-inf-gw-s1',
        'X-User-ID': 'usr-inf-gw-s1',
        'X-Tenant-ID': 'tnt-inf-gw-s1',
        'X-Service-Name': 'ai-orchestrator',
      },
      body: JSON.stringify(inferenceReq),
    });

    expect(res.status).toBe(200);
    const { events, text } = await consumeSseStream(res);
    expect(events).toHaveLength(3);
    expect(text).toBe('Gateway streaming');
    expect(streamPayloadCaptured).toBeDefined();
    expect((streamPayloadCaptured as GatewayDispatchPayload | undefined)?.stream).toBe(true);
  });

  it('3. proves model gateway -> Anthropic adapter streaming', async () => {
    // 1. Start mock Anthropic stream server
    const mock = createMockAnthropicStreamServer({
      tokens: ['Anthropic', ' adapter', ' streams', ' successfully.'],
    });
    mockServer = mock.server;
    await new Promise<void>((resolve) => {
      mockServer!.listen(0, '127.0.0.1', () => {
        const addr = mockServer!.address() as AddressInfo;
        mockPort = addr.port;
        resolve();
      });
    });

    // 2. Start Model Gateway pointing to mock Anthropic API
    const gwConfig = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      anthropic: {
        apiKey: 'sk-ant-test-key-mock',
        baseUrl: `http://127.0.0.1:${mockPort}`,
      },
    });
    modelGatewayService = new ModelGatewayService({ config: gwConfig });
    gatewayPort = await modelGatewayService.start();

    // 3. Dispatch streaming model execution
    const dispatchPayload: GatewayDispatchPayload = {
      requestId: 'req-mgw-s1',
      correlationId: 'corr-mgw-s1',
      actorId: 'test-actor',
      canonicalModelId: 'claude-sonnet',
      version: 'v1.0.0',
      messages: [{ role: 'user', content: 'Stream test' }],
      stream: true,
      limits: { contextWindowTokens: 200000, maxOutputTokens: 8192 },
      pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
      eligibleTargets: [
        {
          targetId: 'target-anthropic-claude-3-5-sonnet',
          provider: 'anthropic',
          upstreamModelId: 'claude-3-5-sonnet-20241022',
          weight: 100,
          priority: 1,
          supportsStreaming: true,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        targets: ['target-anthropic-claude-3-5-sonnet'],
        maxFallbackAttempts: 1,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      exposeReasoning: true,
    };

    const res = await fetch(`http://127.0.0.1:${gatewayPort}/internal/v1/models/dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Request-ID': 'req-mgw-s1',
        'X-Correlation-ID': 'corr-mgw-s1',
        'X-User-ID': 'usr-mgw-s1',
        'X-Tenant-ID': 'tnt-mgw-s1',
        'X-Service-Name': 'inference',
      },
      body: JSON.stringify(dispatchPayload),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const { events, text } = await consumeSseStream(res);
    expect(text).toBe('Anthropic adapter streams successfully.');
    const finishEvent = events.find((e) => e.event === 'finish');
    expect(finishEvent).toBeDefined();
    expect(finishEvent?.data.finishReason).toBe('stop');
  });

  it('4. proves complete streaming request/response flow through all services (E2E with Mock Anthropic Provider)', async () => {
    // 1. Start mock Anthropic stream server
    const mock = createMockAnthropicStreamServer({
      tokens: ['Quantum', ' computing', ' uses', ' qubits.'],
    });
    mockServer = mock.server;
    await new Promise<void>((resolve) => {
      mockServer!.listen(0, '127.0.0.1', () => {
        const addr = mockServer!.address() as AddressInfo;
        mockPort = addr.port;
        resolve();
      });
    });

    // 2. Start Model Gateway
    const mgwConfig = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      anthropic: {
        apiKey: 'sk-ant-test-key-stream-e2e',
        baseUrl: `http://127.0.0.1:${mockPort}`,
      },
    });
    modelGatewayService = new ModelGatewayService({ config: mgwConfig });
    gatewayPort = await modelGatewayService.start();

    // 3. Start Model Registry
    const regConfig = loadModelRegistryConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      autoSeedRealModel: true,
    });
    modelRegistryService = new ModelRegistryService({ config: regConfig });
    registryPort = await modelRegistryService.start();

    // 4. Start Inference Service
    const infConfig = loadInferenceConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      modelGatewayBaseUrl: `http://127.0.0.1:${gatewayPort}`,
    });
    inferenceService = new InferenceService({ config: infConfig });
    inferencePort = await inferenceService.start();

    // 5. Start AI Orchestrator
    const orchConfig = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      modelRegistryBaseUrl: `http://127.0.0.1:${registryPort}`,
      inferenceBaseUrl: `http://127.0.0.1:${inferencePort}`,
      memoryBaseUrl: 'in-memory',
    });
    orchestratorService = new AiOrchestratorService({ config: orchConfig });
    orchestratorPort = await orchestratorService.start();

    // 6. Start Platform API Gateway
    const gatewayDistPath = resolve(
      process.cwd(),
      '../platform/services/api-gateway/dist/index.js',
    );
    const gatewayModuleUrl = pathToFileURL(gatewayDistPath).href;
    const {
      GatewayServiceInstance,
      StaticTokenVerifier,
      loadServiceConfig,
      createIdentityContext,
    } = await import(gatewayModuleUrl);

    const testToken = 'valid-stream-e2e-bearer-token';
    const staticVerifier = new StaticTokenVerifier([
      {
        token: testToken,
        identity: createIdentityContext({
          userId: 'usr_stream_client_99',
          tenantId: 'tnt_stream_corp_88',
          scopes: ['ai:use'],
        }),
      },
    ]);

    const platGwConfig = loadServiceConfig({
      port: 0,
      host: '127.0.0.1',
      orchestratorBaseUrl: `http://127.0.0.1:${orchestratorPort}`,
      environment: 'test',
      logLevel: 'silent',
    });
    gatewayService = new GatewayServiceInstance({
      config: platGwConfig,
      tokenVerifier: staticVerifier,
    });
    platformGatewayPort = await gatewayService.start();

    // 7. Execute streaming request via Platform API Gateway
    const clientPayload: OrchestratorChatRequest = {
      conversationId: 'conv-e2e-stream-01',
      model: 'claude-sonnet',
      messages: [{ role: 'user', content: 'What is quantum computing?' }],
      stream: true,
    };

    const clientRes = await fetch(`http://127.0.0.1:${platformGatewayPort}/api/v1/ai/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${testToken}`,
        'X-Correlation-ID': 'corr-stream-e2e-001',
      },
      body: JSON.stringify(clientPayload),
    });

    expect(clientRes.status).toBe(200);
    expect(clientRes.headers.get('content-type')).toContain('text/event-stream');

    const { events, text } = await consumeSseStream(clientRes);
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(text).toBe('Quantum computing uses qubits.');

    const finishEvent = events.find((e) => e.event === 'finish');
    expect(finishEvent).toBeDefined();
    expect(finishEvent?.data.finishReason).toBe('stop');
    expect(finishEvent?.data.usage.promptTokens).toBe(18);
    expect(finishEvent?.data.usage.completionTokens).toBe(8);

    // 8. Verify upstream mock received Anthropic headers and request
    const upstreamHeaders = mock.getCapturedHeaders();
    expect(upstreamHeaders).toBeDefined();
    expect(upstreamHeaders?.['x-api-key']).toBe('sk-ant-test-key-stream-e2e');
    expect(upstreamHeaders?.['anthropic-version']).toBe('2023-06-01');

    const upstreamBody = mock.getCapturedBody();
    expect(upstreamBody).toBeDefined();
    expect(upstreamBody?.['model']).toBe('claude-3-5-sonnet-20241022');
    expect(upstreamBody?.['stream']).toBe(true);
    expect(upstreamBody?.['messages']).toEqual([
      { role: 'user', content: 'What is quantum computing?' },
    ]);
  }, 30000);

  it('5. proves client abort cancels downstream stream', async () => {
    // 1. Start mock Anthropic stream server with deliberate delay
    const mock = createMockAnthropicStreamServer({
      delayMs: 200,
      tokens: ['Token1', 'Token2', 'Token3', 'Token4'],
    });
    mockServer = mock.server;
    await new Promise<void>((resolve) => {
      mockServer!.listen(0, '127.0.0.1', () => {
        const addr = mockServer!.address() as AddressInfo;
        mockPort = addr.port;
        resolve();
      });
    });

    // 2. Start Model Gateway
    const mgwConfig = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      anthropic: {
        apiKey: 'sk-ant-test-abort',
        baseUrl: `http://127.0.0.1:${mockPort}`,
      },
    });
    modelGatewayService = new ModelGatewayService({ config: mgwConfig });
    gatewayPort = await modelGatewayService.start();

    // 3. Start Model Registry
    const regConfig = loadModelRegistryConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      autoSeedRealModel: true,
    });
    modelRegistryService = new ModelRegistryService({ config: regConfig });
    registryPort = await modelRegistryService.start();

    // 4. Start Inference Service
    const infConfig = loadInferenceConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      modelGatewayBaseUrl: `http://127.0.0.1:${gatewayPort}`,
    });
    inferenceService = new InferenceService({ config: infConfig });
    inferencePort = await inferenceService.start();

    // 5. Start AI Orchestrator
    const orchConfig = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      modelRegistryBaseUrl: `http://127.0.0.1:${registryPort}`,
      inferenceBaseUrl: `http://127.0.0.1:${inferencePort}`,
      memoryBaseUrl: 'in-memory',
    });
    orchestratorService = new AiOrchestratorService({ config: orchConfig });
    orchestratorPort = await orchestratorService.start();

    // 6. Connect client with AbortController and abort after receiving first chunk
    const abortController = new AbortController();
    const clientPayload: OrchestratorChatRequest = {
      conversationId: 'conv-abort-test',
      model: 'claude-sonnet',
      messages: [{ role: 'user', content: 'Slow stream' }],
      stream: true,
    };

    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Request-ID': 'req-abort-1',
        'X-Correlation-ID': 'corr-abort-1',
        'X-User-ID': 'usr-abort-1',
        'X-Tenant-ID': 'tnt-abort-1',
        'X-Service-Name': 'api-gateway',
      },
      body: JSON.stringify(clientPayload),
      signal: abortController.signal,
    });

    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    // Read the first chunk then abort
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);
    abortController.abort();

    // Wait slightly for cancellation to propagate downstream
    await new Promise((r) => setTimeout(r, 300));
    expect(mock.wasAborted()).toBe(true);
  }, 30000);

  it.skipIf(!process.env['ANTHROPIC_API_KEY'])(
    '6. proves complete streaming request/response flow with Live Anthropic Provider',
    async () => {
      const apiKey = process.env['ANTHROPIC_API_KEY']!;

      const mgwConfig = loadModelGatewayConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        anthropic: { apiKey },
      });
      modelGatewayService = new ModelGatewayService({ config: mgwConfig });
      gatewayPort = await modelGatewayService.start();

      const regConfig = loadModelRegistryConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        autoSeedRealModel: true,
      });
      modelRegistryService = new ModelRegistryService({ config: regConfig });
      registryPort = await modelRegistryService.start();

      const infConfig = loadInferenceConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        modelGatewayBaseUrl: `http://127.0.0.1:${gatewayPort}`,
      });
      inferenceService = new InferenceService({ config: infConfig });
      inferencePort = await inferenceService.start();

      const orchConfig = loadAiOrchestratorConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        modelRegistryBaseUrl: `http://127.0.0.1:${registryPort}`,
        inferenceBaseUrl: `http://127.0.0.1:${inferencePort}`,
        memoryBaseUrl: 'in-memory',
      });
      orchestratorService = new AiOrchestratorService({ config: orchConfig });
      orchestratorPort = await orchestratorService.start();

      const clientPayload: OrchestratorChatRequest = {
        conversationId: 'conv-live-stream-01',
        model: 'claude-sonnet',
        messages: [{ role: 'user', content: 'Say HELLO_OICUNT_STREAM in one word.' }],
        stream: true,
      };

      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'X-Request-ID': 'req-live-stream-1',
            'X-Correlation-ID': 'corr-live-stream-1',
            'X-User-ID': 'usr-live-1',
            'X-Tenant-ID': 'tnt-live-1',
            'X-Service-Name': 'api-gateway',
          },
          body: JSON.stringify(clientPayload),
        },
      );

      expect(res.status).toBe(200);
      const { events, text } = await consumeSseStream(res);
      expect(text).toContain('HELLO_OICUNT_STREAM');
      const finishEvent = events.find((e) => e.event === 'finish');
      expect(finishEvent).toBeDefined();
      expect(finishEvent?.data.finishReason).toBe('stop');
      console.log('Live Anthropic streaming text:', text);
    },
    60000,
  );
});
