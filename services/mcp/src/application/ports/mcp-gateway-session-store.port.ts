import type { McpServerGatewaySession } from '../../domain/server-session.js';

export interface McpGatewaySessionStorePort {
  create(session: McpServerGatewaySession): Promise<void>;
  get(sessionId: string): Promise<McpServerGatewaySession | null>;
  touch(sessionId: string): Promise<boolean>;
  delete(sessionId: string): Promise<boolean>;
  evictExpired(now?: number): Promise<number>;
  size(): Promise<number>;
}
