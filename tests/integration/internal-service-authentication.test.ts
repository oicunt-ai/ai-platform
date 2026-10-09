import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CanonicalModel,
  ModelRegistryService,
  ModelTarget,
  ModelVersion,
} from '@oicunt-ai/service-model-registry';
import { loadModelRegistryConfig } from '../../services/model-registry/src/config.js';
import { ModelGatewayService } from '@oicunt-ai/service-model-gateway';
import { InMemoryAdapterRegistry } from '../../services/model-gateway/src/infrastructure/adapters/in-memory-adapter-registry.js';
import { FakeProviderAdapter } from '../../services/model-gateway/tests/test-doubles/fake-provider-adapter.js';
import { loadModelGatewayConfig } from '../../services/model-gateway/src/config.js';
import { InferenceService } from '@oicunt-ai/service-inference';
import { loadInferenceConfig } from '../../services/inference/src/config.js';
import { AiOrchestratorService } from '@oicunt-ai/service-ai-orchestrator';
import { loadAiOrchestratorConfig } from '../../services/ai-orchestrator/src/config.js';
import { createInternalServiceToken } from '../../services/ai-orchestrator/src/infrastructure/security/internal-service-token.js';

describe('Step 6 - Internal Service Authentication Integration Tests', () => {
  const internalSecret = 'shared-internal-test-secret-value-32chars!';

  describe('AI Orchestrator Boundary Protection', () => {
    let orchestratorService: AiOrchestratorService;
    let orchestratorPort: number;

    const fakeInferencePort = {
      async executeUnary(req: any) {
        return {
          success: true,
          data: {
            completionId: 'cmpl-auth-test',
            canonicalModelId: req.canonicalModelId,
            message: { role: 'assistant', content: 'Auth test response' },
            finishReason: 'stop',
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
            latencyMs: 10,
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

    const fakeRegistryPort = {
      async resolveModel(query: any) {
        return {
          canonicalModelId: query.canonicalModelId,
          version: '1.0.0',
          displayName: 'Test Model',
          capabilities: {
            reasoning: false,
            streaming: true,
            toolCalling: false,
            multimodal: false,
            maxContextTokens: 100000,
            maxOutputTokens: 4096,
          },
          limits: { contextWindowTokens: 100000, maxOutputTokens: 4096 },
          pricing: { costPerMillionInputTokens: 3.0, costPerMillionOutputTokens: 15.0 },
          eligibleTargets: [
            {
              targetId: 'target-1',
              provider: 'test-provider',
              upstreamModelId: 'provider-model-alpha',
              priority: 1,
              weight: 100,
              supportsStreaming: true,
            },
          ],
          routingPolicy: {
            strategy: 'priority-fallback',
            maxFallbackAttempts: 1,
            requireHealthyTarget: true,
            degradationBehavior: 'fail-fast',
          },
        };
      },
      async checkHealth() {
        return true;
      },
    };

    beforeEach(async () => {
      const config = loadAiOrchestratorConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        internalToken: internalSecret,
        allowedServiceIdentities: ['api-gateway', 'platform-api-gateway'],
        memoryBaseUrl: 'in-memory',
      });

      orchestratorService = new AiOrchestratorService({
        config,
        inference: fakeInferencePort as any,
        modelRegistry: fakeRegistryPort as any,
      });

      orchestratorPort = await orchestratorService.start();
    });

    afterEach(async () => {
      await orchestratorService.stop();
    });

    const validChatBody = JSON.stringify({
      model: 'oicunt.model.catalog-alpha',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    it('1. valid service credential succeeds and returns 200', async () => {
      const token = createInternalServiceToken({
        serviceName: 'api-gateway',
        audience: 'ai-orchestrator',
        secret: internalSecret,
        expiresInSeconds: 60,
        correlationId: 'corr-auth-success',
        userId: 'usr_trusted_1',
        tenantId: 'tnt_trusted_1',
      });

      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Service-Name': 'api-gateway',
            'X-Correlation-ID': 'corr-auth-success',
            'X-User-ID': 'usr_trusted_1',
            'X-Tenant-ID': 'tnt_trusted_1',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.meta?.correlationId).toBe('corr-auth-success');
    });

    it('2. missing credential rejected with 401', async () => {
      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Name': 'api-gateway',
            'X-Correlation-ID': 'corr-auth-missing',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.error?.code).toBe('AUTHENTICATION_ERROR');
      // Correlation ID continues to propagate across auth error
      expect(res.headers.get('x-correlation-id')).toBe('corr-auth-missing');
    });

    it('3. invalid token signature rejected with 401', async () => {
      const tamperedToken = createInternalServiceToken({
        serviceName: 'api-gateway',
        audience: 'ai-orchestrator',
        secret: 'wrong-secret-key',
      });

      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tamperedToken}`,
            'X-Service-Name': 'api-gateway',
            'X-Correlation-ID': 'corr-auth-invalid',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.error?.code).toBe('AUTHENTICATION_ERROR');
      expect(res.headers.get('x-correlation-id')).toBe('corr-auth-invalid');
    });

    it('4. expired credential rejected with 401', async () => {
      const expiredToken = createInternalServiceToken({
        serviceName: 'api-gateway',
        audience: 'ai-orchestrator',
        secret: internalSecret,
        expiresInSeconds: -10, // expired 10 seconds ago
      });

      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${expiredToken}`,
            'X-Service-Name': 'api-gateway',
            'X-Correlation-ID': 'corr-auth-expired',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.error?.code).toBe('AUTHENTICATION_ERROR');
      expect(data.error?.message.toLowerCase()).toContain('expired');
      expect(res.headers.get('x-correlation-id')).toBe('corr-auth-expired');
    });

    it('5. wrong service / audience rejected with 403', async () => {
      const wrongAudToken = createInternalServiceToken({
        serviceName: 'api-gateway',
        audience: 'inference', // wrong audience
        secret: internalSecret,
        expiresInSeconds: 60,
      });

      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${wrongAudToken}`,
            'X-Service-Name': 'api-gateway',
            'X-Correlation-ID': 'corr-auth-wrong-aud',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.error?.code).toBe('FORBIDDEN');
      expect(data.error?.message).toContain('audience');
      expect(res.headers.get('x-correlation-id')).toBe('corr-auth-wrong-aud');
    });

    it('6. unauthorized service identity rejected with 403', async () => {
      const unauthorizedToken = createInternalServiceToken({
        serviceName: 'untrusted-crawler-service',
        audience: 'ai-orchestrator',
        secret: internalSecret,
        expiresInSeconds: 60,
      });

      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${unauthorizedToken}`,
            'X-Service-Name': 'untrusted-crawler-service',
            'X-Correlation-ID': 'corr-auth-unauthorized-svc',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.error?.code).toBe('FORBIDDEN');
      expect(data.error?.message).toContain('not authorized');
      expect(res.headers.get('x-correlation-id')).toBe('corr-auth-unauthorized-svc');
    });

    it('7. spoofed X-Service-Name header rejected with 403', async () => {
      // Valid token for api-gateway, but header claims to be admin-service
      const token = createInternalServiceToken({
        serviceName: 'api-gateway',
        audience: 'ai-orchestrator',
        secret: internalSecret,
        expiresInSeconds: 60,
        correlationId: 'corr-auth-spoofed-svc',
      });

      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Service-Name': 'admin-service', // Spoofed header!
            'X-Correlation-ID': 'corr-auth-spoofed-svc',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(403);
      const data = (await res.json()) as any;
      expect(data.error?.code).toBe('FORBIDDEN');
      expect(data.error?.message).toContain('Spoofed X-Service-Name');
      expect(res.headers.get('x-correlation-id')).toBe('corr-auth-spoofed-svc');
    });

    it('8. spoofed user/tenant headers rejected without auth (401)', async () => {
      // Untrusted caller sends user/tenant headers without internal auth token
      const res = await fetch(
        `http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': 'usr_spoofed_admin',
            'X-Tenant-ID': 'tnt_spoofed_enterprise',
            'X-Service-Name': 'api-gateway',
            'X-Correlation-ID': 'corr-auth-spoofed-user',
          },
          body: validChatBody,
        },
      );

      expect(res.status).toBe(401);
      const data = (await res.json()) as any;
      expect(data.error?.code).toBe('AUTHENTICATION_ERROR');
      expect(res.headers.get('x-correlation-id')).toBe('corr-auth-spoofed-user');
    });
  });

  describe('Full Multi-Hop Authenticated Runtime Flow', () => {
    let modelGatewayService: ModelGatewayService | null = null;
    let modelRegistryService: ModelRegistryService | null = null;
    let inferenceService: InferenceService | null = null;
    let orchestratorService: AiOrchestratorService | null = null;
    let gatewayService: any = null;

    let gatewayPort: number;
    let registryPort: number;
    let inferencePort: number;
    let orchestratorPort: number;
    let platformGatewayPort: number;

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
      if (modelRegistryService) {
        await modelRegistryService.stop();
        modelRegistryService = null;
      }
      if (modelGatewayService) {
        await modelGatewayService.stop();
        modelGatewayService = null;
      }
    });

    it('proves authenticated execution end-to-end through API Gateway -> Orchestrator -> Inference -> Model Gateway', async () => {
      // 1. Start Model Gateway with a provider-neutral test adapter.
      const mgwConfig = loadModelGatewayConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        internalToken: internalSecret,
        allowedServiceIdentities: ['inference'],
      });
      const adapterRegistry = new InMemoryAdapterRegistry([
        new FakeProviderAdapter('test-provider', {
          unaryHandler: async (request) => ({
            completionId: request.completionId,
            model: request.payload.canonicalModelId,
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Secure multi-hop response successfully returned!' }],
            },
            finishReason: 'stop',
            usage: { promptTokens: 20, completionTokens: 15, totalTokens: 35 },
            latencyMs: 1,
          }),
        }),
      ]);
      modelGatewayService = new ModelGatewayService({ config: mgwConfig, adapterRegistry });
      gatewayPort = await modelGatewayService.start();

      // 2. Register a catalog model and its internal provider target.
      const regConfig = loadModelRegistryConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        internalAuthToken: internalSecret,
        allowedServiceIdentities: ['ai-orchestrator'],
      });
      modelRegistryService = new ModelRegistryService({ config: regConfig });
      const model = new CanonicalModel({
        id: 'oicunt.model.catalog-alpha',
        displayName: 'Catalog Model Alpha',
        description: 'Provider-neutral integration-test catalog model',
        activeVersion: 'v1.0.0',
      });
      const version = new ModelVersion({
        id: 'version-catalog-alpha-v1',
        canonicalModelId: model.id,
        version: 'v1.0.0',
        modalities: ['text'],
        capabilities: {
          streaming: true,
          toolCalling: false,
          structuredOutputs: false,
          reasoning: false,
          vision: false,
          audioInput: false,
          audioOutput: false,
          systemInstructions: true,
        },
        limits: { contextWindowTokens: 32_000, maxOutputTokens: 4_096 },
        pricing: { costPerMillionInputTokens: 0, costPerMillionOutputTokens: 0 },
        status: 'available',
      });
      model.addVersion(version);
      model.addTarget(
        new ModelTarget({
          id: 'target-provider-a-alpha',
          modelVersionId: version.id,
          provider: 'test-provider',
          upstreamModelId: 'provider-model-alpha-v1',
          status: 'available',
        }),
      );
      await modelRegistryService.getModelRepository().save(model);
      registryPort = await modelRegistryService.start();

      // 3. Start Inference Service with internal authentication
      const infConfig = loadInferenceConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        internalToken: internalSecret,
        allowedServiceIdentities: ['ai-orchestrator'],
        modelGatewayBaseUrl: `http://127.0.0.1:${gatewayPort}`,
      });
      inferenceService = new InferenceService({ config: infConfig });
      inferencePort = await inferenceService.start();

      // 4. Start AI Orchestrator with internal authentication
      const orchConfig = loadAiOrchestratorConfig({
        port: 0,
        host: '127.0.0.1',
        environment: 'test',
        logLevel: 'silent',
        internalToken: internalSecret,
        allowedServiceIdentities: ['api-gateway'],
        modelRegistryBaseUrl: `http://127.0.0.1:${registryPort}`,
        inferenceBaseUrl: `http://127.0.0.1:${inferencePort}`,
        memoryBaseUrl: 'in-memory',
      });
      orchestratorService = new AiOrchestratorService({ config: orchConfig });
      orchestratorPort = await orchestratorService.start();

      // 5. Start Platform API Gateway with internal service secret
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

      const clientToken = 'valid-client-user-jwt';
      const staticVerifier = new StaticTokenVerifier([
        {
          token: clientToken,
          identity: createIdentityContext({
            userId: 'usr_auth_verified_user',
            tenantId: 'tnt_auth_verified_tenant',
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
        internalServiceSecret: internalSecret,
      });

      gatewayService = new GatewayServiceInstance({
        config: platGwConfig,
        tokenVerifier: staticVerifier,
      });
      platformGatewayPort = await gatewayService.start();

      // 6. Make public client request to Platform API Gateway
      const clientReq = {
        conversationId: 'conv-auth-test-1',
        model: 'oicunt.model.catalog-alpha',
        messages: [{ role: 'user', content: 'Prove multi-hop service authentication.' }],
      };

      const res = await fetch(`http://127.0.0.1:${platformGatewayPort}/api/v1/ai/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${clientToken}`,
          'X-Correlation-ID': 'corr-auth-multihop-999',
        },
        body: JSON.stringify(clientReq),
      });

      const rawBody = await res.text();
      expect(res.status, rawBody).toBe(200);
      const body = JSON.parse(rawBody) as any;
      expect(body.success).toBe(true);
      expect(body.data?.model).toBe('oicunt.model.catalog-alpha');
      expect(body.data?.message?.content).toEqual([
        { type: 'text', text: 'Secure multi-hop response successfully returned!' },
      ]);
      expect(body.meta?.correlationId).toBe('corr-auth-multihop-999');
    }, 15_000);
  });
});
