import type { McpClientRuntimePort } from '../../application/ports/mcp-client-runtime.port.js';
import type {
  McpTransportFactoryPort,
  McpTransportPort,
} from '../../application/ports/mcp-transport.port.js';
import type { McpServerRepositoryPort } from '../../application/ports/mcp-server-repository.port.js';
import type { SecretStorePort } from '../../application/ports/secret-store.port.js';
import type { McpServerId } from '../../domain/types.js';
import { McpServerNotFoundError } from '../../domain/errors.js';

export class McpClientRuntime implements McpClientRuntimePort {
  private readonly sessions = new Map<McpServerId, McpTransportPort>();
  private readonly listChangedCallbacks = new Map<McpServerId, Array<() => Promise<void> | void>>();

  constructor(
    private readonly repository: McpServerRepositoryPort,
    private readonly transportFactory: McpTransportFactoryPort,
    private readonly secretStore?: SecretStorePort | undefined,
  ) {}

  public async getOrCreateSession(
    serverId: McpServerId,
    tenantId: string,
  ): Promise<McpTransportPort> {
    const existing = this.sessions.get(serverId);
    if (existing && existing.isConnected()) {
      return existing;
    }

    if (existing) {
      await existing.disconnect().catch(() => {});
      this.sessions.delete(serverId);
    }

    const registration = await this.repository.findById(serverId, tenantId);
    if (!registration) {
      throw new McpServerNotFoundError(serverId);
    }

    let resolvedSecret: string | undefined;
    if (registration.authSecretRef && this.secretStore) {
      const secret = await this.secretStore.getSecret(registration.authSecretRef, tenantId);
      if (secret) {
        resolvedSecret = secret;
      }
    }

    const transport = await this.transportFactory.createTransport(registration, resolvedSecret);
    await transport.connect();

    transport.onClose(() => {
      this.sessions.delete(serverId);
    });

    transport.onNotification('notifications/tools/list_changed', () => {
      const callbacks = this.listChangedCallbacks.get(serverId) ?? [];
      for (const cb of callbacks) {
        try {
          void cb();
        } catch {
          // Handled inside callback
        }
      }
    });

    this.sessions.set(serverId, transport);
    return transport;
  }

  public async disconnectSession(serverId: McpServerId): Promise<void> {
    const transport = this.sessions.get(serverId);
    if (transport) {
      this.sessions.delete(serverId);
      await transport.disconnect().catch(() => {});
    }
  }

  public isSessionActive(serverId: McpServerId): boolean {
    const transport = this.sessions.get(serverId);
    return transport ? transport.isConnected() : false;
  }

  public onToolsListChanged(serverId: McpServerId, callback: () => Promise<void> | void): void {
    const callbacks = this.listChangedCallbacks.get(serverId) ?? [];
    callbacks.push(callback);
    this.listChangedCallbacks.set(serverId, callbacks);
  }

  public async closeAll(): Promise<void> {
    for (const [serverId, transport] of this.sessions.entries()) {
      this.sessions.delete(serverId);
      await transport.disconnect().catch(() => {});
    }
    this.listChangedCallbacks.clear();
  }
}
