import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CanonicalModelId, ReasoningEffortLevel } from '@oicunt-ai/model-types';
import {
  CanonicalModel,
  ModelRegistryService,
  ModelTarget,
  ModelVersion,
} from '@oicunt-ai/service-model-registry';
import { loadModelRegistryConfig } from '../../services/model-registry/src/config.js';
import { ModelGatewayService } from '@oicunt-ai/service-model-gateway';
import { loadModelGatewayConfig } from '../../services/model-gateway/src/config.js';
import { InMemoryAdapterRegistry } from '../../services/model-gateway/src/infrastructure/adapters/in-memory-adapter-registry.js';
import { FakeProviderAdapter } from '../../services/model-gateway/tests/test-doubles/fake-provider-adapter.js';
import type { UsagePublisherPort } from '../../services/model-gateway/src/application/ports/usage-publisher.port.js';
import type { UsageEvent } from '@oicunt-ai/usage-types';
import { InferenceService } from '@oicunt-ai/service-inference';
import { loadInferenceConfig } from '../../services/inference/src/config.js';
import { AiOrchestratorService } from '@oicunt-ai/service-ai-orchestrator';
import { loadAiOrchestratorConfig } from '../../services/ai-orchestrator/src/config.js';
import { createInternalServiceToken } from '../../services/ai-orchestrator/src/infrastructure/security/internal-service-token.js';
import { FakeMemory } from '../../services/ai-orchestrator/tests/test-doubles/fake-memory.js';

/**
 * Fake-provider end-to-end coverage for Registry -> Model Gateway -> Inference
 * -> Orchestrator over real HTTP hops. Replaces the removed Anthropic-mocked E2E
 * without reintroducing Anthropic or any real provider.
 *
 * Deliberately NOT duplicated here (already proven elsewhere):
 * - happy-path unary through the platform gateway (internal-service-authentication
 *   multi-hop test), gateway usage-publish ordering and failure accounting at the
 *   use-case level (dispatch-streaming tests).
 */
describe('E2E - Fake Provider Completion Chain', () => {
  const internalSecret = 'fake-provider-e2e-shared-secret-32chars!';
  const REASONING_MODEL = 'oicunt.model.e2e-reasoning';
  const PLAIN_MODEL = 'oicunt.model.e2e-plain';

  let modelGatewayService: ModelGatewayService | null = null;
  let modelRegistryService: ModelRegistryService | null = null;
  let inferenceService: InferenceService | null = null;
  let orchestratorService: AiOrchestratorService | null = null;

  let orchestratorPort = 0;
  let fakeMemory: FakeMemory;
  let fakeAdapter: FakeProviderAdapter;
  const publishedEvents: UsageEvent[] = [];
  let publisherShouldFail = false;

  const stubPublisher: UsagePublisherPort = {
    async start(): Promise<void> {},
    async publish(event: UsageEvent): Promise<void> {
      if (publisherShouldFail) throw new Error('E2E stub usage publisher unavailable');
      publishedEvents.push(event);
    },
    isReady(): boolean {
      return true;
    },
    async close(): Promise<void> {},
  };

  function clientHeaders(correlationId: string): Record<string, string> {
    const tenantId = 'tnt_e2e';
    const userId = 'usr_e2e';
    const requestId = `req-${correlationId}`;
    const token = createInternalServiceToken({
      serviceName: 'test-client',
      audience: 'ai-orchestrator',
      secret: internalSecret,
      tenantId,
      userId,
      requestId,
      correlationId,
    });
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Service-Name': 'test-client',
      'X-Tenant-ID': tenantId,
      'X-User-ID': userId,
      'X-Request-ID': requestId,
      'X-Correlation-ID': correlationId,
    };
  }

  function seedModel(
    id: CanonicalModelId,
    capabilities: {
      readonly reasoning: boolean;
      readonly supportedEffortLevels?: readonly ReasoningEffortLevel[];
      readonly defaultEffortLevel?: ReasoningEffortLevel;
    },
    targetId: string,
  ): void {
    const model = new CanonicalModel({
      id,
      displayName: id,
      description: `E2E model ${id}`,
      activeVersion: 'v1.0.0',
    });
    const version = new ModelVersion({
      id: `version-${targetId}`,
      canonicalModelId: model.id,
      version: 'v1.0.0',
      modalities: ['text'],
      capabilities: {
        streaming: true,
        toolCalling: false,
        structuredOutputs: false,
        vision: false,
        audioInput: false,
        audioOutput: false,
        systemInstructions: true,
        ...capabilities,
      },
      limits: { contextWindowTokens: 32_000, maxOutputTokens: 4_096 },
      pricing: { costPerMillionInputTokens: 0, costPerMillionOutputTokens: 0 },
      status: 'available',
    });
    model.addVersion(version);
    model.addTarget(
      new ModelTarget({
        id: targetId,
        modelVersionId: version.id,
        provider: 'test-provider',
        upstreamModelId: `upstream-${targetId}`,
        status: 'available',
      }),
    );
    void modelRegistryService?.getModelRepository().save(model);
  }

  beforeAll(async () => {
    fakeMemory = new FakeMemory();
    fakeAdapter = new FakeProviderAdapter('test-provider');

    const mgwConfig = loadModelGatewayConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalToken: internalSecret,
      allowedServiceIdentities: ['inference'],
    });
    modelGatewayService = new ModelGatewayService({
      config: mgwConfig,
      adapterRegistry: new InMemoryAdapterRegistry([fakeAdapter]),
      usagePublisher: stubPublisher,
    });
    const gatewayPort = await modelGatewayService.start();

    const regConfig = loadModelRegistryConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalAuthToken: internalSecret,
      allowedServiceIdentities: ['ai-orchestrator'],
    });
    modelRegistryService = new ModelRegistryService({ config: regConfig });
    seedModel(
      REASONING_MODEL,
      { reasoning: true, supportedEffortLevels: ['low'], defaultEffortLevel: 'low' },
      'target-e2e-reasoning',
    );
    seedModel(PLAIN_MODEL, { reasoning: false }, 'target-e2e-plain');
    const registryPort = await modelRegistryService.start();

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
    const inferencePort = await inferenceService.start();

    const orchConfig = loadAiOrchestratorConfig({
      port: 0,
      host: '127.0.0.1',
      environment: 'test',
      logLevel: 'silent',
      internalToken: internalSecret,
      allowedServiceIdentities: ['test-client'],
      modelRegistryBaseUrl: `http://127.0.0.1:${registryPort}`,
      inferenceBaseUrl: `http://127.0.0.1:${inferencePort}`,
      memoryBaseUrl: 'in-memory',
    });
    orchestratorService = new AiOrchestratorService({
      config: orchConfig,
      memory: fakeMemory,
    });
    orchestratorPort = await orchestratorService.start();
  }, 30_000);

  afterAll(async () => {
    await orchestratorService?.stop();
    await inferenceService?.stop();
    await modelRegistryService?.stop();
    await modelGatewayService?.stop();
  });

  beforeEach(() => {
    publishedEvents.length = 0;
    publisherShouldFail = false;
    fakeMemory.shouldFailCheckpointWith = null;
    fakeMemory.shouldFailGetContextWith = null;
    fakeMemory.conversations.clear();
    fakeMemory.recordedCheckpoints.length = 0;
    fakeMemory.recordedContextCalls.length = 0;
    fakeAdapter.setUnaryDelayMs(0);
    fakeAdapter.setStreamDelayMs(0);
  });

  it('completes a unary turn and records usage plus a memory checkpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: clientHeaders('corr-e2e-unary'),
      body: JSON.stringify({
        model: REASONING_MODEL,
        conversationId: 'conv_e2e_unary',
        messages: [{ role: 'user', content: 'Hello E2E' }],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data?.finishReason).toBe('stop');
    expect(body.data?.model).toBe(REASONING_MODEL);

    expect(fakeMemory.recordedCheckpoints).toHaveLength(1);
    expect(publishedEvents.length).toBeGreaterThanOrEqual(1);
    const usage = publishedEvents[0]!;
    expect(usage.tenantId).toBe('tnt_e2e');
    expect(usage.idempotencyKey.startsWith('model.completion:')).toBe(true);
    expect(usage.measurements['units.requests']).toBe(1);
    expect(usage.lineage.correlationId).toBe('corr-e2e-unary');
  });

  it('streams tokens with exactly one terminal finish event in order', async () => {
    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        ...clientHeaders('corr-e2e-stream'),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: REASONING_MODEL,
        conversationId: 'conv_e2e_stream',
        messages: [{ role: 'user', content: 'Stream E2E' }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    const eventNames = [...text.matchAll(/^event: (\w+)/gm)].map((m) => m[1]);
    expect(eventNames.length).toBeGreaterThan(1);
    expect(eventNames.filter((e) => e === 'token').length).toBeGreaterThanOrEqual(1);
    expect(eventNames.filter((e) => e === 'finish')).toHaveLength(1);
    expect(eventNames[eventNames.length - 1]).toBe('finish');
    expect(eventNames).not.toContain('error');
    expect(fakeMemory.recordedCheckpoints).toHaveLength(1);
    expect(publishedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('withholds finish when the memory checkpoint fails', async () => {
    fakeMemory.shouldFailCheckpointWith = new Error('E2E checkpoint failure');

    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        ...clientHeaders('corr-e2e-checkpoint-fail'),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: REASONING_MODEL,
        conversationId: 'conv_e2e_checkpoint_fail',
        messages: [{ role: 'user', content: 'Checkpoint must gate finish' }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).not.toContain('event: finish');
  });

  it('propagates cancellation without emitting finish', async () => {
    fakeAdapter.setStreamDelayMs(250);
    const controller = new AbortController();

    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: {
        ...clientHeaders('corr-e2e-cancel'),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: REASONING_MODEL,
        conversationId: 'conv_e2e_cancel',
        messages: [{ role: 'user', content: 'Cancel me' }],
        stream: true,
      }),
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    let text = '';
    try {
      for (;;) {
        const chunk = await reader!.read();
        if (chunk.done || !chunk.value) break;
        text += Buffer.from(chunk.value).toString('utf-8');
        if (text.includes('event: token')) {
          controller.abort();
          break;
        }
      }
      await reader!.cancel().catch(() => undefined);
    } finally {
      reader?.releaseLock();
    }

    expect(text).toContain('event: token');
    expect(text).not.toContain('event: finish');
  }, 30_000);

  it('rejects an unknown model resolved through the real registry', async () => {
    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: clientHeaders('corr-e2e-unknown-model'),
      body: JSON.stringify({
        model: 'oicunt.model.does-not-exist',
        conversationId: 'conv_e2e_unknown',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('MODEL_NOT_FOUND');
    expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
  });

  it('rejects unsupported reasoning effort resolved through the real registry', async () => {
    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: clientHeaders('corr-e2e-effort'),
      body: JSON.stringify({
        model: PLAIN_MODEL,
        conversationId: 'conv_e2e_effort',
        messages: [{ role: 'user', content: 'Hello' }],
        effort: 'high',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('UNSUPPORTED_EFFORT_LEVEL');
    expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
  });

  it('fails the turn when usage confirmation fails so no success is reported', async () => {
    publisherShouldFail = true;

    const res = await fetch(`http://127.0.0.1:${orchestratorPort}/internal/v1/orchestrator/chat`, {
      method: 'POST',
      headers: clientHeaders('corr-e2e-usage-fail'),
      body: JSON.stringify({
        model: REASONING_MODEL,
        conversationId: 'conv_e2e_usage_fail',
        messages: [{ role: 'user', content: 'Usage must confirm' }],
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(publishedEvents).toHaveLength(0);
    expect(fakeMemory.recordedCheckpoints).toHaveLength(0);
  });
});
