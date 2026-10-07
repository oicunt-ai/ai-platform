import { describe, expect, it } from 'vitest';
import { McpServerGatewaySession } from '../../src/domain/server-session.js';

describe('McpServerGatewaySession Domain Entity', () => {
  const baseParams = {
    sessionId: 'test-sess-1',
    tenantId: 'tenant-123',
    userId: 'user-456',
    actorId: 'actor-789',
    roles: ['admin', 'operator'],
    clientInfo: { name: 'claude-desktop', version: '1.0.0' },
    hardExpiresAt: 1000 + 86400000,
    now: 1000,
  };

  it('initializes with uninitialized status and correct properties', () => {
    const session = new McpServerGatewaySession(baseParams);

    expect(session.sessionId).toBe('test-sess-1');
    expect(session.tenantId).toBe('tenant-123');
    expect(session.userId).toBe('user-456');
    expect(session.actorId).toBe('actor-789');
    expect(session.roles).toEqual(['admin', 'operator']);
    expect(session.clientInfo.name).toBe('claude-desktop');
    expect(session.status).toBe('uninitialized');
    expect(session.createdAt).toBe(1000);
    expect(session.lastActivityAt).toBe(1000);
    expect(session.hardExpiresAt).toBe(1000 + 86400000);
  });

  it('updates lastActivityAt on touch()', () => {
    const session = new McpServerGatewaySession(baseParams);
    session.touch(5000);
    expect(session.lastActivityAt).toBe(5000);
  });

  it('transitions to active status on markActive()', () => {
    const session = new McpServerGatewaySession(baseParams);
    session.markActive();
    expect(session.status).toBe('active');
  });

  it('calculates expiration based on inactivity and hard TTL', () => {
    const session = new McpServerGatewaySession({
      ...baseParams,
      hardExpiresAt: 10000,
      now: 1000,
    });

    const inactivityTimeout = 2000;

    // Active within window
    expect(session.isExpired(1500, inactivityTimeout)).toBe(false);

    // Inactivity timeout exceeded (now: 3001, lastActivityAt: 1000, diff: 2001 >= 2000)
    expect(session.isExpired(3001, inactivityTimeout)).toBe(true);

    // Touch keeps it alive
    session.touch(2500);
    expect(session.isExpired(3001, inactivityTimeout)).toBe(false);

    // Hard TTL exceeded
    expect(session.isExpired(10001, inactivityTimeout)).toBe(true);
  });

  it('handles in-flight request registration and cancellation', () => {
    const session = new McpServerGatewaySession(baseParams);
    const controller = new AbortController();

    session.registerRequest('req-1', controller);
    expect(controller.signal.aborted).toBe(false);

    const cancelled = session.cancelRequest('req-1', 'Cancelled by client');
    expect(cancelled).toBe(true);
    expect(controller.signal.aborted).toBe(true);

    // Cancelling non-existent request returns false
    expect(session.cancelRequest('non-existent')).toBe(false);
  });

  it('terminates and aborts all registered requests', () => {
    const session = new McpServerGatewaySession(baseParams);
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();

    session.registerRequest(1, ctrl1);
    session.registerRequest(2, ctrl2);

    session.terminate('Closing down');

    expect(session.status).toBe('terminated');
    expect(ctrl1.signal.aborted).toBe(true);
    expect(ctrl2.signal.aborted).toBe(true);
    expect(session.isExpired(1500, 50000)).toBe(true);
  });
});
