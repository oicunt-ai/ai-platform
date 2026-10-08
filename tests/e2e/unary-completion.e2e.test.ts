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

interface MockAnthropicResponse {
  readonly id: string;
  readonly type: 'message';
  readonly role: 'assistant';
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly model: string;
  readonly stop_reason: 'end_turn';
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
}

const mockResponseData: MockAnthropicResponse = {
  id: 'msg_e2e_test_01',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Quantum computing leverages superposition and entanglement.' }],
  model: 'claude-3-5-sonnet-20241022',
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 18,
    output_tokens: 10,
  },
};

function createMockAnthropicServer(responseBody: MockAnthropicResponse = mockResponseData) {
  let capturedHeaders: http.IncomingHttpHeaders | null = null;
  let capturedBody: Record<string, unknown> | null = null;

  const server = http.createServer((req, res) => {
    capturedHeaders = req.headers;
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        capturedBody = JSON.parse(data) as Record<string, unknown>;
      } catch {
        capturedBody = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });

  return {
    server,
    getCapturedHeaders: () => capturedHeaders,
    getCapturedBody: () => capturedBody,
  };
}

describe('OICUNT AI Step 4 - Unary E2E', () => {
  // Service instances
  let mockServer: http.Server | null = null;
  let mockPort: number;
  let modelRegistryService: ModelRegistryService | null = null;
  let modelGatewayService: ModelGatewayService | null = null;
  let inferenceService: InferenceService | null = null;
  let orchestratorService: AiOrchestratorService | null = null;
  let gatewayService: any = null;

  // Bound ports
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
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
      mockServer = null;
    }
  });

  it('1. proves model resolution -> inference execution', async () => {
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

    // 2. Mock Inference Port to capture what Orchestrator resolves and sends
    let receivedInferenceRequest: any = null;
    const fakeInferencePort = {
      async executeUnary(req: any) {
        receivedInferenceRequest = req;
        return {
          success: true,
          data: {
            completionId: 'test-cmpl-1',
            canonicalModelId: req.canonicalModelId,
            message: { role: 'assistant', content: 'Resolved and executed' },
            finishReason: 'stop',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            latencyMs: 50,
          },
          meta: {
            requestId: req.requestId,
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
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

    // 4. Send chat turn requesting 'claude-sonnet'
    const chatReq: OrchestratorChatRequest = {
      model: 'claude-sonnet',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      conversationId: 'conv-res-1',
    };

    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'req-res-1',
        'X-Correlation-ID': 'corr-res-1',
        'X-User-ID': 'user-1',
        'X-Tenant-ID': 'tenant-1',
        'X-Service-Name': 'api-gateway',
      },
      body: JSON.stringify(chatReq),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);

    // Verify model resolution drove inference execution
    expect(receivedInferenceRequest).toBeDefined();
    expect(receivedInferenceRequest.canonicalModelId).toBe('claude-sonnet');
    expect(receivedInferenceRequest.version).toBe('v1.0.0');
    expect(receivedInferenceRequest.eligibleTargets).toBeDefined();
    expect(receivedInferenceRequest.eligibleTargets).toHaveLength(1);
    expect(receivedInferenceRequest.eligibleTargets[0].provider).toBe('anthropic');
    expect(receivedInferenceRequest.eligibleTargets[0].upstreamModelId).toBe(
      'claude-3-5-sonnet-20241022',
    );
    expect(receivedInferenceRequest.routingPolicy.strategy).toBe('priority-fallback');
  });

  it('2. proves inference -> model gateway', async () => {
    // 1. Mock Model Gateway Port to capture dispatch
    let receivedDispatchPayload: GatewayDispatchPayload | null = null;
    const fakeModelGatewayPort = {
      async dispatchUnary(payload: GatewayDispatchPayload) {
        receivedDispatchPayload = payload;
        return {
          completionId: 'cmpl-gw-123',
          model: 'claude-3-5-sonnet-20241022',
          message: { role: 'assistant', content: 'Dispatched through gateway' },
          finishReason: 'stop' as const,
          usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
          latencyMs: 75,
        };
      },
      async checkHealth() {
        return true;
      },
    };

    // 2. Start Inference Service connected to fake Model Gateway Port
    const inferenceConfig = loadInferenceConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
    });
    inferenceService = new InferenceService({
      config: inferenceConfig,
      modelGateway: fakeModelGatewayPort as any,
    });
    inferencePort = await inferenceService.start();

    // 3. Dispatch an inference request
    const inferenceReq: InferenceExecutionRequest = {
      requestId: 'req-inf-1',
      correlationId: 'corr-inf-1',
      actorId: 'usr-inf-1',
      stream: false,
      canonicalModelId: 'claude-sonnet',
      version: 'v1.0.0',
      messages: [{ role: 'user', content: 'Hello Inference' }],
      limits: {
        contextWindowTokens: 200000,
        maxOutputTokens: 8192,
      },
      pricing: {
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
        costPerMillionCachedTokens: 0.3,
      },
      eligibleTargets: [
        {
          targetId: 'target-anthropic-claude-3-5-sonnet',
          provider: 'anthropic',
          upstreamModelId: 'claude-3-5-sonnet-20241022',
          weight: 100,
          priority: 1,
          supportsStreaming: false,
        },
      ],
      routingPolicy: {
        strategy: 'priority-fallback',
        targets: ['target-anthropic-claude-3-5-sonnet'],
        maxFallbackAttempts: 2,
        requireHealthyTarget: true,
        degradationBehavior: 'fail-fast',
      },
      deadlineMs: Date.now() + 60000,
      privacyPolicy: {
        exposeReasoning: true,
        redactThinking: false,
        redactThinkingInLogs: true,
      },
    };

    const res = await fetch(`http://127.0.0.1:${inferencePort}/internal/v1/inference/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'req-inf-1',
        'X-Correlation-ID': 'corr-inf-1',
        'X-User-ID': 'usr-inf-1',
        'X-Tenant-ID': 'tnt-inf-1',
        'X-Service-Name': 'ai-orchestrator',
      },
      body: JSON.stringify(inferenceReq),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.completionId).toBe('cmpl-gw-123');

    // Verify dispatch payload passed to Model Gateway
    expect(receivedDispatchPayload).toBeDefined();
    expect(receivedDispatchPayload!.canonicalModelId).toBe('claude-sonnet');
    const firstTarget = receivedDispatchPayload!.eligibleTargets?.[0] as
      { provider: string; upstreamModelId: string } | undefined;
    expect(firstTarget?.provider).toBe('anthropic');
    expect(firstTarget?.upstreamModelId).toBe('claude-3-5-sonnet-20241022');
  });

  it('3. proves model gateway -> Anthropic adapter', async () => {
    // 1. Start mock Anthropic upstream API server
    const mock = createMockAnthropicServer();
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

    // 3. Dispatch unary model execution
    const dispatchPayload: GatewayDispatchPayload = {
      requestId: 'req-mgw-1',
      correlationId: 'corr-mgw-1',
      actorId: 'test-actor',
      canonicalModelId: 'claude-sonnet',
      version: 'v1.0.0',
      messages: [{ role: 'user', content: 'What is photosynthesis?' }],
      stream: false,
      limits: {
        contextWindowTokens: 200000,
        maxOutputTokens: 8192,
      },
      pricing: {
        costPerMillionInputTokens: 3.0,
        costPerMillionOutputTokens: 15.0,
        costPerMillionCachedTokens: 0.3,
      },
      eligibleTargets: [
        {
          targetId: 'target-anthropic-claude-3-5-sonnet',
          provider: 'anthropic',
          upstreamModelId: 'claude-3-5-sonnet-20241022',
          weight: 100,
          priority: 1,
          supportsStreaming: false,
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
        'X-Request-ID': 'req-mgw-1',
        'X-Correlation-ID': 'corr-mgw-1',
        'X-User-ID': 'user-1',
        'X-Tenant-ID': 'tenant-1',
        'X-Service-Name': 'inference',
      },
      body: JSON.stringify(dispatchPayload),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.completionId).toBeDefined();
    expect(body.data.model).toBe('claude-sonnet');
    expect(body.data.message.content).toBe(
      'Quantum computing leverages superposition and entanglement.',
    );
    expect(body.data.finishReason).toBe('stop');
    expect(body.data.usage.promptTokens).toBe(18);
    expect(body.data.usage.completionTokens).toBe(10);
    expect(body.data.usage.totalTokens).toBe(28);

    // Verify upstream call reached mock Anthropic API
    const sentHeaders = mock.getCapturedHeaders();
    expect(sentHeaders).toBeDefined();
    expect(sentHeaders?.['x-api-key']).toBe('sk-ant-test-key-mock');
    expect(sentHeaders?.['anthropic-version']).toBe('2023-06-01');

    const sentBody = mock.getCapturedBody();
    expect(sentBody).toBeDefined();
    expect(sentBody?.['model']).toBe('claude-3-5-sonnet-20241022');
    expect(sentBody?.['messages']).toEqual([{ role: 'user', content: 'What is photosynthesis?' }]);
  });

  it('4. proves complete unary request/response flow through all services (E2E with Mock Anthropic Provider)', async () => {
    // 1. Start mock Anthropic upstream API server
    const mock = createMockAnthropicServer();
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
        apiKey: 'sk-ant-test-key-e2e',
        baseUrl: `http://127.0.0.1:${mockPort}`,
      },
    });
    modelGatewayService = new ModelGatewayService({ config: mgwConfig });
    gatewayPort = await modelGatewayService.start();

    // 3. Start Model Registry (with auto-seeded claude-sonnet)
    const regConfig = loadModelRegistryConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      autoSeedRealModel: true,
    });
    modelRegistryService = new ModelRegistryService({ config: regConfig });
    registryPort = await modelRegistryService.start();

    // 4. Start Inference Service (pointing to Model Gateway)
    const infConfig = loadInferenceConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      modelGatewayBaseUrl: `http://127.0.0.1:${gatewayPort}`,
    });
    inferenceService = new InferenceService({ config: infConfig });
    inferencePort = await inferenceService.start();

    // 5. Start AI Orchestrator (pointing to Model Registry and Inference)
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

    const testToken = 'valid-e2e-bearer-token';
    const staticVerifier = new StaticTokenVerifier([
      {
        token: testToken,
        identity: createIdentityContext({
          userId: 'usr_e2e_billy_user',
          tenantId: 'tnt_e2e_enterprise',
          scopes: ['ai:use'],
        }),
      },
    ]);

    const platGwConfig = loadServiceConfig({
      serviceName: 'api-gateway',
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      orchestratorBaseUrl: `http://127.0.0.1:${orchestratorPort}`,
    });

    gatewayService = new GatewayServiceInstance({
      config: platGwConfig,
      tokenVerifier: staticVerifier,
    });
    platformGatewayPort = await gatewayService.start();

    // 7. Execute complete unary request from BILLY / Client through Platform API Gateway
    const clientPayload = {
      conversationId: 'conv-e2e-complete-1',
      model: 'claude-sonnet',
      messages: [{ role: 'user', content: 'Explain quantum computing in one sentence.' }],
    };

    const clientRes = await fetch(`http://127.0.0.1:${platformGatewayPort}/api/v1/ai/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
        'X-Correlation-ID': 'corr-e2e-billy-trace-1',
      },
      body: JSON.stringify(clientPayload),
    });

    // 8. Assert end-to-end response
    expect(clientRes.status).toBe(200);
    expect(clientRes.headers.get('content-type')).toContain('application/json');
    expect(clientRes.headers.get('x-correlation-id')).toBe('corr-e2e-billy-trace-1');
    expect(clientRes.headers.get('x-request-id')).toBeDefined();

    const responseBody = (await clientRes.json()) as any;
    expect(responseBody.success).toBe(true);
    expect(responseBody.data.completionId).toBeDefined();
    expect(responseBody.data.model).toBe('claude-sonnet');
    expect(responseBody.data.version).toBe('v1.0.0');
    expect(responseBody.data.message.role).toBe('assistant');
    expect(responseBody.data.message.content).toBe(
      'Quantum computing leverages superposition and entanglement.',
    );
    expect(responseBody.data.finishReason).toBe('stop');
    expect(responseBody.data.usage.promptTokens).toBe(18);
    expect(responseBody.data.usage.completionTokens).toBe(10);
    expect(responseBody.data.usage.totalTokens).toBe(28);
    expect(responseBody.data.turnLatencyMs).toBeGreaterThanOrEqual(0);

    // 9. Verify upstream received call with authenticated Anthropic headers
    const upstreamHeaders = mock.getCapturedHeaders();
    expect(upstreamHeaders).toBeDefined();
    expect(upstreamHeaders?.['x-api-key']).toBe('sk-ant-test-key-e2e');
    expect(upstreamHeaders?.['anthropic-version']).toBe('2023-06-01');

    const upstreamBody = mock.getCapturedBody();
    expect(upstreamBody).toBeDefined();
    expect(upstreamBody?.['model']).toBe('claude-3-5-sonnet-20241022');
    expect(upstreamBody?.['messages']).toEqual([
      { role: 'user', content: 'Explain quantum computing in one sentence.' },
    ]);
  }, 30000);

  it.skipIf(!process.env['ANTHROPIC_API_KEY'])(
    '5. proves complete unary request/response flow with Live Anthropic Provider',
    async () => {
      const apiKey = process.env['ANTHROPIC_API_KEY']!;

      // 1. Start Model Gateway with real Anthropic credentials and live API endpoint
      const mgwConfig = loadModelGatewayConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'development',
        logLevel: 'info',
        anthropic: {
          apiKey,
          baseUrl: 'https://api.anthropic.com',
        },
      });
      modelGatewayService = new ModelGatewayService({ config: mgwConfig });
      gatewayPort = await modelGatewayService.start();

      // 2. Start Model Registry with real model definition
      const regConfig = loadModelRegistryConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        autoSeedRealModel: true,
      });
      modelRegistryService = new ModelRegistryService({ config: regConfig });
      registryPort = await modelRegistryService.start();

      // 3. Start Inference Service
      const infConfig = loadInferenceConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        modelGatewayBaseUrl: `http://127.0.0.1:${gatewayPort}`,
      });
      inferenceService = new InferenceService({ config: infConfig });
      inferencePort = await inferenceService.start();

      // 4. Start AI Orchestrator
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

      // 5. Start Platform API Gateway
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

      const testToken = 'valid-live-e2e-token';
      const staticVerifier = new StaticTokenVerifier([
        {
          token: testToken,
          identity: createIdentityContext({
            userId: 'usr_live_test_user',
            tenantId: 'tnt_live_test_tenant',
            scopes: ['ai:use'],
          }),
        },
      ]);

      const platGwConfig = loadServiceConfig({
        serviceName: 'api-gateway',
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        orchestratorBaseUrl: `http://127.0.0.1:${orchestratorPort}`,
      });

      gatewayService = new GatewayServiceInstance({
        config: platGwConfig,
        tokenVerifier: staticVerifier,
      });
      platformGatewayPort = await gatewayService.start();

      // 6. Execute live unary request
      const clientPayload = {
        conversationId: 'conv-live-e2e-001',
        model: 'claude-sonnet',
        messages: [
          { role: 'user', content: "Reply with the word 'HELLO_OICUNT' and nothing else." },
        ],
      };

      const clientRes = await fetch(
        `http://127.0.0.1:${platformGatewayPort}/api/v1/ai/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${testToken}`,
            'X-Correlation-ID': 'corr-live-anthropic-e2e-1',
          },
          body: JSON.stringify(clientPayload),
        },
      );

      expect(clientRes.status).toBe(200);
      const responseBody = (await clientRes.json()) as any;
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.completionId).toMatch(/^msg_/);
      expect(responseBody.data.model).toBe('claude-sonnet');
      expect(responseBody.data.version).toBe('v1.0.0');
      expect(responseBody.data.message.content).toContain('HELLO_OICUNT');
      expect(responseBody.data.finishReason).toBe('stop');
      expect(responseBody.data.usage.promptTokens).toBeGreaterThan(0);
      expect(responseBody.data.usage.completionTokens).toBeGreaterThan(0);
      console.log('Live Anthropic completion response:', responseBody.data);
    },
  );
});
