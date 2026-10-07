import { describe, expect, it } from 'vitest';
import { InMemoryMcpGatewaySessionStore } from '../../src/infrastructure/repositories/in-memory-mcp-gateway-session.store.js';
import { McpServerGatewaySession } from '../../src/domain/server-session.js';

describe('InMemoryMcpGatewaySessionStore', () => {
  const createTestSession = (id: string, now = Date.now(), ttl = 60000) => {
    return new McpServerGatewaySession({
      sessionId: id,
      tenantId: 'tenant-1',
      userId: 'user-1',
      actorId: 'actor-1',
      roles: ['user'],
      clientInfo: { name: 'test-client', version: '1.0' },
      hardExpiresAt: now + ttl,
      now,
    });
  };

  it('stores and retrieves an active session', async () => {
    const store = new InMemoryMcpGatewaySessionStore({
      inactivityTimeoutMs: 10000,
      hardSessionTtlMs: 60000,
    });

    const session = createTestSession('sess-1');
    await store.create(session);

    const retrieved = await store.get('sess-1');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.sessionId).toBe('sess-1');
    expect(await store.size()).toBe(1);
  });

  it('evicts and returns null when session is expired by inactivity', async () => {
    const store = new InMemoryMcpGatewaySessionStore({
      inactivityTimeoutMs: 100, // 100ms timeout
      hardSessionTtlMs: 60000,
    });

    const session = createTestSession('sess-2', Date.now() - 500);
    await store.create(session);

    const retrieved = await store.get('sess-2');
    expect(retrieved).toBeNull();
    expect(await store.size()).toBe(0);
  });

  it('evicts and returns null when session exceeds hard TTL', async () => {
    const store = new InMemoryMcpGatewaySessionStore({
      inactivityTimeoutMs: 60000,
      hardSessionTtlMs: 200,
    });

    const session = createTestSession('sess-3', Date.now() - 500, 200);
    await store.create(session);

    const retrieved = await store.get('sess-3');
    expect(retrieved).toBeNull();
    expect(await store.size()).toBe(0);
  });

  it('deletes a session and terminates it', async () => {
    const store = new InMemoryMcpGatewaySessionStore({
      inactivityTimeoutMs: 60000,
      hardSessionTtlMs: 60000,
    });

    const session = createTestSession('sess-4');
    await store.create(session);

    const deleted = await store.delete('sess-4');
    expect(deleted).toBe(true);
    expect(session.status).toBe('terminated');
    expect(await store.get('sess-4')).toBeNull();
  });

  it('clears all sessions and terminates them', async () => {
    const store = new InMemoryMcpGatewaySessionStore({
      inactivityTimeoutMs: 60000,
      hardSessionTtlMs: 60000,
    });

    const s1 = createTestSession('s1');
    const s2 = createTestSession('s2');
    await store.create(s1);
    await store.create(s2);

    expect(await store.size()).toBe(2);
    store.clear();
    expect(await store.size()).toBe(0);
    expect(s1.status).toBe('terminated');
    expect(s2.status).toBe('terminated');
  });
});
