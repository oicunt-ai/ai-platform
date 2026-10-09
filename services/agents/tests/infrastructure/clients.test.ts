import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpInferenceClient } from '../../src/infrastructure/clients/http-inference.client.js';
import { HttpToolsClient } from '../../src/infrastructure/clients/http-tools.client.js';
import { HttpKnowledgeClient } from '../../src/infrastructure/clients/http-knowledge.client.js';

describe('HTTP Outbound Clients Integration', () => {
  let mockServer: Server;
  let baseUrl: string;

  beforeAll(async () => {
    mockServer = createServer((req, res) => {
      const url = req.url ?? '/';

      if (url === '/internal/v1/inference/execute') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: {
              completionId: 'comp_mock_1',
              message: { role: 'assistant', content: 'Inference mock response' },
              finishReason: 'stop',
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            },
          }),
        );
        return;
      }

      if (url === '/internal/v1/tools/execute') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              output: { calculated: 100 },
              durationMs: 12,
            },
          }),
        );
        return;
      }

      if (url === '/internal/v1/knowledge/retrieve') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: {
              chunks: [
                {
                  chunkId: 'chunk_1',
                  documentId: 'doc_1',
                  collectionId: 'col_1',
                  content: 'Relevant snippet',
                  score: 0.95,
                },
              ],
            },
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = mockServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  it('executes model inference via HttpInferenceClient', async () => {
    const client = new HttpInferenceClient({ baseUrl });
    const response = await client.execute({
      requestId: 'req_1',
      correlationId: 'corr_1',
      canonicalModelId: 'oicunt.model.catalog-alpha',
      messages: [{ role: 'user', content: 'Hi' }],
      deadlineMs: Date.now() + 10_000,
      tenantId: 'ten_1',
      actorId: 'act_1',
    });

    expect(response.completionId).toBe('comp_mock_1');
    expect(response.message.content).toBe('Inference mock response');
  });

  it('executes tool call via HttpToolsClient', async () => {
    const client = new HttpToolsClient({ baseUrl });
    const outcome = await client.executeTool({
      toolId: 'oicunt.tool.calc',
      callId: 'call_1',
      arguments: {},
      tenantId: 'ten_1',
      actorId: 'act_1',
      correlationId: 'corr_1',
    });

    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect((outcome.output as any).calculated).toBe(100);
    }
  });

  it('retrieves knowledge chunks via HttpKnowledgeClient', async () => {
    const client = new HttpKnowledgeClient({ baseUrl });
    const chunks = await client.retrieve({
      query: 'test query',
      collectionIds: ['col_1'],
      tenantId: 'ten_1',
      actorId: 'act_1',
      correlationId: 'corr_1',
    });

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.chunkId).toBe('chunk_1');
    expect(chunks[0]!.content).toBe('Relevant snippet');
  });
});
