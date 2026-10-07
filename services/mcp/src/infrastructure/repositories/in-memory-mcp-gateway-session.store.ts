import type { McpGatewaySessionStorePort } from '../../application/ports/mcp-gateway-session-store.port.js';
import type { McpServerGatewaySession } from '../../domain/server-session.js';

export interface InMemoryMcpGatewaySessionStoreOptions {
  readonly inactivityTimeoutMs: number;
  readonly hardSessionTtlMs: number;
}

export class InMemoryMcpGatewaySessionStore implements McpGatewaySessionStorePort {
  private readonly sessions = new Map<string, McpServerGatewaySession>();
  private readonly inactivityTimeoutMs: number;

  constructor(options: InMemoryMcpGatewaySessionStoreOptions) {
    this.inactivityTimeoutMs = options.inactivityTimeoutMs;
  }

  public async create(session: McpServerGatewaySession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  public async get(sessionId: string): Promise<McpServerGatewaySession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    if (session.isExpired(Date.now(), this.inactivityTimeoutMs)) {
      session.terminate('Session expired due to inactivity or hard TTL');
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  public async touch(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) {
      return false;
    }
    session.touch();
    return true;
  }

  public async delete(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.terminate('Session closed');
    this.sessions.delete(sessionId);
    return true;
  }

  public async evictExpired(now = Date.now()): Promise<number> {
    let evictedCount = 0;
    for (const [id, session] of this.sessions.entries()) {
      if (session.isExpired(now, this.inactivityTimeoutMs)) {
        session.terminate('Session expired');
        this.sessions.delete(id);
        evictedCount++;
      }
    }
    return evictedCount;
  }

  public async size(): Promise<number> {
    return this.sessions.size;
  }

  public clear(): void {
    for (const session of this.sessions.values()) {
      session.terminate('Store cleared');
    }
    this.sessions.clear();
  }
}
