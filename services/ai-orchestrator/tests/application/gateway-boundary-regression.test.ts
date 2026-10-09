import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiOrchestratorService } from '../../src/service.js';
import { loadAiOrchestratorConfig } from '../../src/config.js';
import { CoordinateChatTurnUseCase } from '../../src/application/use-cases/coordinate-chat-turn.use-case.js';
import { FakeModelRegistry } from '../test-doubles/fake-model-registry.js';
import { FakeInference } from '../test-doubles/fake-inference.js';
import type { TurnExecutionContext } from '../../src/domain/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../../src');

describe('Regression - Gateway Boundary Isolation', () => {
  const mockContext: TurnExecutionContext = {
    turnId: 'turn_reg_1',
    requestId: 'req_reg_1',
    correlationId: 'corr_reg_1',
    actorId: 'test-actor',
    serviceName: 'billy-api',
    tenantId: 'ten_regression',
    userId: 'usr_reg',
    startTime: Date.now(),
  };

  it('Orchestrator service exposes getInference and does NOT expose getModelGateway', () => {
    const fakeRegistry = new FakeModelRegistry();
    const fakeInference = new FakeInference();

    const service = new AiOrchestratorService({
      modelRegistry: fakeRegistry,
      inference: fakeInference,
    });

    expect(typeof service.getInference).toBe('function');
    expect(service.getInference()).toBe(fakeInference);
    expect((service as unknown as Record<string, unknown>)['getModelGateway']).toBeUndefined();
  });

  it('unary execution dispatches solely through InferencePort and conveys complete pass-through metadata', async () => {
    const fakeRegistry = new FakeModelRegistry();
    const fakeInference = new FakeInference();

    const useCase = new CoordinateChatTurnUseCase({
      modelRegistry: fakeRegistry,
      inference: fakeInference,
    });

    const response = await useCase.executeUnary(
      {
        model: 'oicunt.model.catalog-alpha',
        messages: [{ role: 'user', content: 'Regression test query' }],
        tools: [
          {
            name: 'calc',
            description: 'Calculator',
            parameters: { type: 'object' },
          },
        ],
      },
      mockContext,
    );

    expect(response.success).toBe(true);
    expect(fakeInference.recordedRequests).toHaveLength(1);

    const inferenceReq = fakeInference.recordedRequests[0]!;
    expect(inferenceReq.canonicalModelId).toBe('oicunt.model.catalog-alpha');
    expect(inferenceReq.version).toBe('v1.0.0');
    expect(inferenceReq.stream).toBe(false);
    expect(inferenceReq.effort).toBe('medium');
    expect(inferenceReq.tools).toHaveLength(1);
    expect(inferenceReq.tools?.[0]?.name).toBe('calc');
    expect(inferenceReq.eligibleTargets).toBeDefined();
    expect(inferenceReq.routingPolicy).toBeDefined();
    expect(inferenceReq.limits).toBeDefined();
    expect(inferenceReq.pricing).toBeDefined();
    expect(inferenceReq.privacyPolicy?.exposeReasoning).toBe(true);
    expect(inferenceReq.deadlineMs).toBeGreaterThan(Date.now());
    expect(inferenceReq.tenantId).toBe('ten_regression');
    expect(inferenceReq.userId).toBe('usr_reg');
    expect(inferenceReq.actorId).toBe('test-actor');
    expect(inferenceReq.correlationId).toBe('corr_reg_1');
    expect(inferenceReq.requestId).toBe('req_reg_1');
  });

  it('streaming execution dispatches solely through InferencePort and conveys stream=true', async () => {
    const fakeRegistry = new FakeModelRegistry();
    const fakeInference = new FakeInference();

    const useCase = new CoordinateChatTurnUseCase({
      modelRegistry: fakeRegistry,
      inference: fakeInference,
    });

    const stream = useCase.executeStream(
      {
        model: 'oicunt.model.catalog-alpha',
        messages: [{ role: 'user', content: 'Regression streaming query' }],
        stream: true,
      },
      mockContext,
    );

    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(fakeInference.recordedRequests).toHaveLength(1);
    expect(fakeInference.recordedRequests[0]?.stream).toBe(true);
  });

  it('configuration loads inferenceBaseUrl and does not load modelGatewayBaseUrl', () => {
    const config = loadAiOrchestratorConfig();
    expect(config.inferenceBaseUrl).toBeDefined();
    expect((config as unknown as Record<string, unknown>)['modelGatewayBaseUrl']).toBeUndefined();
  });

  it('source files under src/ have zero references to ModelGatewayPort or HttpModelGatewayClient', () => {
    function getAllTsFiles(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getAllTsFiles(fullPath));
        } else if (entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const tsFiles = getAllTsFiles(srcDir);
    expect(tsFiles.length).toBeGreaterThan(5);

    for (const filePath of tsFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('ModelGatewayPort');
      expect(content).not.toContain('HttpModelGatewayClient');
      expect(content).not.toContain('model-gateway.port');
      expect(content).not.toContain('http-model-gateway.client');
    }
  });
});
