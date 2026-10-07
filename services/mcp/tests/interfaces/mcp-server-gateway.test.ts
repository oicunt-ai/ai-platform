import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpService } from '../../src/service.js';
import { loadMcpConfig } from '../../src/config.js';
import { InMemoryToolsService } from '../../src/infrastructure/clients/http-tools.client.js';

describe('MCP Server Gateway (Direction B) Integration', () => {
  let service: McpService;
  let toolsService: InMemoryToolsService;
  let port: number;

  beforeEach(async () => {
    toolsService = new InMemoryToolsService();
    const config = loadMcpConfig({
      port: 0,
      useDatabase: false,
      logLevel: 'silent',
      allowLocalhost: true,
      maxRequestSizeBytes: 1024 * 64, // 64KB for tests
      serverSessionInactivityTimeoutMs: 5000,
      serverSessionMaxTtlMs: 30000,
      internalToken: 'test-internal-token',
    });

    service = new McpService({
      config,
      toolsService,
    });
    port = await service.start();
  });

  afterEach(async () => {
    await service.stop();
  });

  const sendMcpRequest = async (
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; headers: Headers; json: any }> => {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: rawBody,
    });

    const respHeaders = res.headers;
    const status = res.status;
    let json: any = null;
    if (status !== 204) {
      const text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    return { status, headers: respHeaders, json };
  };

  it('rejects invalid JSON with parse error -32700', async () => {
    const res = await sendMcpRequest('invalid-json{{{', {
      Authorization: 'Bearer test-actor:t1:u1:a1',
    });

    expect(res.status).toBe(200);
    expect(res.json.error.code).toBe(-32700);
    expect(res.json.error.message).toContain('Parse error');
  });

  it('rejects invalid JSON-RPC payload structure with -32600', async () => {
    const res = await sendMcpRequest(
      { method: 'ping' }, // missing jsonrpc: '2.0'
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );

    expect(res.status).toBe(200);
    expect(res.json.error.code).toBe(-32600);
  });

  it('rejects payload exceeding maximum size limit with HTTP 413', async () => {
    const bigString = 'x'.repeat(1024 * 70); // 70KB exceeds 64KB
    const res = await sendMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'ping', params: { data: bigString } },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );

    expect(res.status).toBe(413);
  });

  it('rejects initialize when perimeter authentication is missing or invalid', async () => {
    // Missing credentials
    const noAuth = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'test', version: '1.0' },
      },
    });
    expect(noAuth.status).toBe(200);
    expect(noAuth.json.error.code).toBe(-32003);

    // Invalid credentials
    const badAuth = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'test', version: '1.0' },
        },
      },
      { Authorization: 'Bearer invalid-token-format' },
    );
    expect(badAuth.status).toBe(200);
    expect(badAuth.json.error.code).toBe(-32003);
  });

  it('completes the initialize and notifications/initialized handshake', async () => {
    // 1. Initialize
    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          clientInfo: { name: 'cursor', version: '0.40.0' },
        },
      },
      { Authorization: 'Bearer test-actor:acme-tenant:user-1:actor-1:admin' },
    );

    expect(initRes.status).toBe(200);
    expect(initRes.json.id).toBe('init-1');
    expect(initRes.json.result.protocolVersion).toBe('2024-11-05');
    expect(initRes.json.result.serverInfo.name).toBe('oicunt-mcp-gateway');
    expect(initRes.json.result.capabilities.tools).toBeDefined();

    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    expect(sessionId).toMatch(/^mcp_sess_/);

    // 2. notifications/initialized
    const notifRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      },
      { 'Mcp-Session-Id': sessionId! },
    );

    expect(notifRes.status).toBe(204);
  });

  it('rejects non-initialize requests without Mcp-Session-Id header', async () => {
    const res = await sendMcpRequest({
      jsonrpc: '2.0',
      id: 10,
      method: 'ping',
    });

    expect(res.status).toBe(200);
    expect(res.json.error.code).toBe(-32003);
    expect(res.json.error.message).toContain('Missing mandatory Mcp-Session-Id');
  });

  it('rejects requests with unknown or expired session ID', async () => {
    const res = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'ping',
      },
      { 'Mcp-Session-Id': 'mcp_sess_nonexistent' },
    );

    expect(res.status).toBe(200);
    expect(res.json.error.code).toBe(-32003);
    expect(res.json.error.message).toContain('Session expired or invalid');
  });

  it('rejects cross-tenant hijacking when client sends contradictory X-Tenant-ID header', async () => {
    // 1. Initialize for tenant 'tenant-alpha'
    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:tenant-alpha:user-1:actor-1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    // 2. Attempt to make request on sessionId while claiming to be 'tenant-beta'
    const spoofRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      },
      {
        'Mcp-Session-Id': sessionId,
        'X-Tenant-ID': 'tenant-beta', // Spoofed header
      },
    );

    expect(spoofRes.status).toBe(200);
    expect(spoofRes.json.error.code).toBe(-32003);
    expect(spoofRes.json.error.message).toContain('Cross-tenant session access rejected');
  });

  it('handles ping request within active session', async () => {
    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const pingRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 'ping-42',
        method: 'ping',
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(pingRes.status).toBe(200);
    expect(pingRes.json.id).toBe('ping-42');
    expect(pingRes.json.result).toEqual({});
  });

  it('handles unknown method with -32601', async () => {
    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const unknownRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 99,
        method: 'resources/list', // Not supported in Phase 2
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(unknownRes.status).toBe(200);
    expect(unknownRes.json.error.code).toBe(-32601);
    expect(unknownRes.json.error.message).toContain("Method 'resources/list' not found");
  });

  it('discovers tools via tools/list projected from ToolsService', async () => {
    // Register tool in ToolsService
    toolsService.addMockTool({
      name: 'calculate_mortgage',
      description: 'Calculates monthly payment',
      inputSchema: {
        type: 'object',
        properties: { principal: { type: 'number' } },
        required: ['principal'],
      },
    });

    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const listRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(listRes.status).toBe(200);
    expect(listRes.json.id).toBe(2);
    expect(Array.isArray(listRes.json.result.tools)).toBe(true);
    expect(listRes.json.result.tools).toHaveLength(1);
    expect(listRes.json.result.tools[0].name).toBe('calculate_mortgage');
    expect(listRes.json.result.tools[0].description).toBe('Calculates monthly payment');
  });

  it('executes tool via tools/call and returns formatted CallToolResult', async () => {
    toolsService.addMockTool({
      name: 'echo_tool',
      description: 'Echoes parameters',
      inputSchema: { type: 'object' },
    });

    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const callRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 100,
        method: 'tools/call',
        params: {
          name: 'echo_tool',
          arguments: { message: 'hello world' },
        },
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(callRes.status).toBe(200);
    expect(callRes.json.id).toBe(100);
    expect(callRes.json.result.isError).toBe(false);
    expect(callRes.json.result.content).toHaveLength(1);
    expect(callRes.json.result.content[0].type).toBe('text');
    expect(callRes.json.result.content[0].text).toContain('Tool echo_tool executed successfully');
  });

  it('handles tool execution failures with sanitized error messages', async () => {
    toolsService.addMockTool({
      name: 'fail_tool',
      description: 'Always fails',
      inputSchema: { type: 'object' },
    });

    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const callRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 101,
        method: 'tools/call',
        params: {
          name: 'fail_tool',
          arguments: {},
        },
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(callRes.status).toBe(200);
    expect(callRes.json.id).toBe(101);
    expect(callRes.json.result.isError).toBe(true);
    expect(callRes.json.result.content[0].text).toContain('Deliberate tool failure');
  });

  it('handles human-in-the-loop confirmation challenge and subsequent token redemption', async () => {
    toolsService.addMockTool({
      name: 'deploy_production',
      description: 'Gated deployment tool',
      inputSchema: { type: 'object' },
      requiresConfirmation: true,
    } as any);

    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    // 1. Initial call without confirmation token -> returns challenge
    const challengeRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'deploy_production',
          arguments: { service: 'payments' },
        },
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(challengeRes.status).toBe(200);
    expect(challengeRes.json.result.isError).toBe(true);
    const challenge = challengeRes.json.result._confirmationChallenge;
    expect(challenge).toBeDefined();
    expect(challenge.status).toBe('confirmation_required');
    expect(challenge.toolId).toBe('deploy_production');
    expect(challenge.challengeToken).toBeTruthy();

    // 2. Retry call passing confirmation token -> succeeds
    const confirmedRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 103,
        method: 'tools/call',
        params: {
          name: 'deploy_production',
          arguments: {
            service: 'payments',
            _confirmationToken: challenge.challengeToken,
          },
        },
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(confirmedRes.status).toBe(200);
    expect(confirmedRes.json.id).toBe(103);
    expect(confirmedRes.json.result.isError).toBe(false);
    expect(confirmedRes.json.result.content[0].text).toContain('executed successfully');
    // 3. Retry call passing confirmation token via _meta -> also succeeds
    const metaConfirmedRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 104,
        method: 'tools/call',
        params: {
          name: 'deploy_production',
          arguments: {
            service: 'payments',
          },
          _meta: {
            confirmationToken: challenge.challengeToken,
          },
        },
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(metaConfirmedRes.status).toBe(200);
    expect(metaConfirmedRes.json.id).toBe(104);
    expect(metaConfirmedRes.json.result.isError).toBe(false);
  });

  it('preserves legitimate tool argument named confirmationToken and scrubs _confirmationToken', async () => {
    toolsService.addMockTool({
      name: 'verify_otp',
      description: 'Verifies OTP',
      inputSchema: { type: 'object' },
    });

    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    const callRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 200,
        method: 'tools/call',
        params: {
          name: 'verify_otp',
          arguments: {
            confirmationToken: 'legitimate-otp-value-123',
            _confirmationToken: 'some-internal-challenge-token',
          },
        },
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(callRes.status).toBe(200);
    expect(callRes.json.result.isError).toBe(false);
    expect(toolsService.lastExecutedCommand?.arguments['confirmationToken']).toBe(
      'legitimate-otp-value-123',
    );
    expect(toolsService.lastExecutedCommand?.arguments['_confirmationToken']).toBeUndefined();
    expect(toolsService.lastExecutedCommand?.confirmationToken).toBe(
      'some-internal-challenge-token',
    );
  });

  it('authenticates via trusted platform perimeter internal service token with headers', async () => {
    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 300,
        method: 'initialize',
        params: { clientInfo: { name: 'perimeter-gateway', version: '1.0' } },
      },
      {
        'X-Internal-Token': 'test-internal-token',
        'X-Tenant-ID': 'tenant-upstream',
        'X-Actor-ID': 'actor-upstream',
        'X-User-ID': 'user-upstream',
        'X-Roles': 'admin,operator',
      },
    );

    expect(initRes.status).toBe(200);
    expect(initRes.json.id).toBe(300);
    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
  });

  it('handles request cancellation via notifications/cancelled', async () => {
    const initRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'test', version: '1.0' } },
      },
      { Authorization: 'Bearer test-actor:t1:u1:a1' },
    );
    const sessionId = initRes.headers.get('mcp-session-id')!;

    // Send notifications/cancelled
    const cancelRes = await sendMcpRequest(
      {
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 999, reason: 'User navigated away' },
      },
      { 'Mcp-Session-Id': sessionId },
    );

    expect(cancelRes.status).toBe(204);
  });
});
