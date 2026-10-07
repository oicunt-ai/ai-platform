import type {
  McpDiscoveredCapabilities,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpServerRegistration,
  McpToolDescriptor,
} from '../../domain/types.js';
import type { McpTool, McpResource, McpPrompt, McpServerCapabilities } from '@oicunt-ai/mcp-types';
import {
  McpDiscoveryError,
  McpInvalidRequestError,
  McpProtocolError,
  McpSecurityError,
  McpServerNotFoundError,
} from '../../domain/errors.js';
import { computeSchemaHash, normalizeMcpToolToOicunt } from '../../domain/values/normalizer.js';
import { buildCanonicalToolId } from '../../domain/values/identity.js';
import type { McpServerRepositoryPort } from '../ports/mcp-server-repository.port.js';
import type { McpClientRuntimePort } from '../ports/mcp-client-runtime.port.js';
import type { ToolsServicePort } from '../ports/tools-service.port.js';

export const MAX_TOOLS_PER_SERVER = 100;

export interface InitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: McpServerCapabilities;
  readonly serverInfo?: { readonly name: string; readonly version: string } | undefined;
}

export class DiscoverCapabilitiesUseCase {
  constructor(
    private readonly repository: McpServerRepositoryPort,
    private readonly clientRuntime: McpClientRuntimePort,
    private readonly toolsService: ToolsServicePort,
  ) {}

  public async execute(serverId: string, tenantId: string): Promise<McpDiscoveredCapabilities> {
    if (!serverId?.trim()) {
      throw new McpInvalidRequestError('serverId is required');
    }
    if (!tenantId?.trim()) {
      throw new McpInvalidRequestError('tenantId is required');
    }

    const server = await this.repository.findById(serverId.trim(), tenantId.trim());
    if (!server) {
      throw new McpServerNotFoundError(serverId);
    }

    try {
      const transport = await this.clientRuntime.getOrCreateSession(
        server.serverId,
        server.tenantId,
      );

      // 1. Handshake: initialize
      const initResult = await transport.sendRequest<InitializeResult>('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'oicunt-ai-platform-client',
          version: '1.0.0',
        },
      });

      // Send initialized notification
      await transport.sendNotification('notifications/initialized', {});

      const serverCapabilities = initResult?.capabilities ?? {};

      // 2. Discover Tools
      const tools = await this.discoverTools(server, transport);

      // 3. Discover Resources (if supported / graceful fallback)
      const resources = await this.discoverResources(server, transport);

      // 4. Discover Prompts (if supported / graceful fallback)
      const prompts = await this.discoverPrompts(server, transport);

      const discovered: McpDiscoveredCapabilities = {
        tools,
        resources,
        prompts,
        rawServerCapabilities: serverCapabilities,
      };

      // 5. Persist capabilities
      await this.repository.saveDiscoveredCapabilities(
        server.serverId,
        server.tenantId,
        discovered,
      );

      // 6. Update server registration state
      const updatedServer: McpServerRegistration = {
        ...server,
        status: 'active',
        protocolVersion: initResult.protocolVersion || '2024-11-05',
        capabilities: serverCapabilities,
        lastDiscoveredAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await this.repository.save(updatedServer);

      // 7. Subscribe to tools/list_changed for dynamic refresh
      this.clientRuntime.onToolsListChanged(server.serverId, async () => {
        try {
          await this.execute(server.serverId, server.tenantId);
        } catch {
          // Logged by runtime
        }
      });

      return discovered;
    } catch (err) {
      await this.repository.updateStatus(
        server.serverId,
        server.tenantId,
        'error',
        err instanceof Error ? err.message : String(err),
      );

      if (
        err instanceof McpDiscoveryError ||
        err instanceof McpSecurityError ||
        err instanceof McpProtocolError
      ) {
        throw err;
      }
      throw new McpDiscoveryError(
        `Failed to discover capabilities from MCP server '${server.serverId}': ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  private async discoverTools(
    server: McpServerRegistration,
    transport: { sendRequest: <T>(method: string, params?: unknown) => Promise<T> },
  ): Promise<readonly McpToolDescriptor[]> {
    let rawTools: readonly McpTool[];
    try {
      const resp = await transport.sendRequest<{ tools?: readonly McpTool[] }>('tools/list', {});
      rawTools = resp?.tools ?? [];
    } catch (err) {
      const rpcCode = (err as { rpcCode?: number })?.rpcCode;
      if (rpcCode === -32601) {
        // Method not found: server does not provide tools
        return [];
      }
      throw err;
    }

    if (rawTools.length > MAX_TOOLS_PER_SERVER) {
      throw new McpSecurityError(
        `MCP Server '${server.serverId}' returned ${rawTools.length} tools, exceeding maximum limit of ${MAX_TOOLS_PER_SERVER}`,
      );
    }

    const now = new Date().toISOString();
    const descriptors: McpToolDescriptor[] = [];

    for (const rawTool of rawTools) {
      // 1. Normalize into OICUNT ToolDefinition
      const canonicalDefinition = normalizeMcpToolToOicunt(server.serverId, rawTool);

      // 2. Register into canonical Tools Service
      await this.toolsService.registerTool(canonicalDefinition, server.tenantId);

      const canonicalToolId = buildCanonicalToolId(server.serverId, rawTool.name);
      descriptors.push({
        id: canonicalToolId,
        serverId: server.serverId,
        tenantId: server.tenantId,
        originalName: rawTool.name,
        canonicalToolId,
        description: rawTool.description ?? `Tool ${rawTool.name}`,
        inputSchema: canonicalDefinition.parameters,
        schemaHash: computeSchemaHash(rawTool.inputSchema),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return descriptors;
  }

  private async discoverResources(
    server: McpServerRegistration,
    transport: { sendRequest: <T>(method: string, params?: unknown) => Promise<T> },
  ): Promise<readonly McpResourceDescriptor[]> {
    try {
      const resp = await transport.sendRequest<{ resources?: readonly McpResource[] }>(
        'resources/list',
        {},
      );
      const rawResources = resp?.resources ?? [];
      const now = new Date().toISOString();

      return rawResources.map((res) => ({
        id: `${server.serverId}:${res.uri}`,
        serverId: server.serverId,
        tenantId: server.tenantId,
        uri: res.uri,
        name: res.name ?? res.uri,
        description: res.description,
        mimeType: res.mimeType,
        createdAt: now,
        updatedAt: now,
      }));
    } catch (err) {
      const rpcCode = (err as { rpcCode?: number })?.rpcCode;
      if (rpcCode === -32601) {
        return [];
      }
      // Log/ignore graceful fallback for non-essential primitives
      return [];
    }
  }

  private async discoverPrompts(
    server: McpServerRegistration,
    transport: { sendRequest: <T>(method: string, params?: unknown) => Promise<T> },
  ): Promise<readonly McpPromptDescriptor[]> {
    try {
      const resp = await transport.sendRequest<{ prompts?: readonly McpPrompt[] }>(
        'prompts/list',
        {},
      );
      const rawPrompts = resp?.prompts ?? [];
      const now = new Date().toISOString();

      return rawPrompts.map((p) => ({
        id: `${server.serverId}:${p.name}`,
        serverId: server.serverId,
        tenantId: server.tenantId,
        name: p.name,
        description: p.description,
        arguments: (p.arguments ?? []).map((arg) => ({
          name: arg.name,
          description: arg.description,
          required: arg.required,
        })),
        createdAt: now,
        updatedAt: now,
      }));
    } catch (err) {
      const rpcCode = (err as { rpcCode?: number })?.rpcCode;
      if (rpcCode === -32601) {
        return [];
      }
      return [];
    }
  }
}
