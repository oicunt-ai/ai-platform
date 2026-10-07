import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StreamableHttpTransport } from '../../src/infrastructure/transports/streamable-http-transport.js';
import { McpProtocolError, McpTimeoutError } from '../../src/domain/errors.js';

describe('StreamableHttpTransport', () => {
  let server: Server;
  let serverPort: number;
  let receivedRequests: any[] = [];
  let responseHandler: (req: any, res: any) => void;

  beforeEach(async () => {
    receivedRequests = [];
    responseHandler = (_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': 'sess-12345',
      });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: receivedRequests[receivedRequests.length - 1]?.id,
          result: { greeting: 'hello' },
        }),
      );
    };

    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          receivedRequests.push(JSON.parse(body));
        } catch {
          // ignore parse errors
        }
        responseHandler(req, res);
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as any).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connects and sends JSON-RPC request successfully', async () => {
    const transport = new StreamableHttpTransport(
      { url: `http://127.0.0.1:${serverPort}/mcp` },
      'test-secret',
      true, // allow localhost for testing
    );

    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    const result = await transport.sendRequest<{ greeting: string }>('test_method', { foo: 'bar' });
    expect(result).toEqual({ greeting: 'hello' });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('test_method');
    expect(receivedRequests[0].params).toEqual({ foo: 'bar' });

    await transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });

  it('propagates JSON-RPC errors correctly', async () => {
    responseHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: receivedRequests[receivedRequests.length - 1]?.id,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        }),
      );
    };

    const transport = new StreamableHttpTransport(
      { url: `http://127.0.0.1:${serverPort}/mcp` },
      undefined,
      true,
    );

    await transport.connect();

    await expect(transport.sendRequest('unknown_method')).rejects.toThrow(McpProtocolError);
    await transport.disconnect();
  });

  it('respects timeout deadlines', async () => {
    responseHandler = () => {
      // Intentionally don't respond to trigger timeout
    };

    const transport = new StreamableHttpTransport(
      { url: `http://127.0.0.1:${serverPort}/mcp`, timeoutMs: 100 },
      undefined,
      true,
    );

    await transport.connect();

    await expect(transport.sendRequest('slow_method')).rejects.toThrow(McpTimeoutError);
    await transport.disconnect();
  });
});
