import type { CanonicalToolDefinition } from '../../domain/types.js';
import type { ToolsServicePort } from '../../application/ports/tools-service.port.js';

export class HttpToolsClient implements ToolsServicePort {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken?: string | undefined,
  ) {}

  public async registerTool(tool: CanonicalToolDefinition, tenantId?: string): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.internalToken) {
      headers['X-Internal-Token'] = this.internalToken;
      headers['Authorization'] = `Bearer ${this.internalToken}`;
    }
    if (tenantId) {
      headers['X-Tenant-Id'] = tenantId;
    }

    const res = await fetch(`${this.baseUrl}/internal/v1/tools/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(tool),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to register tool '${tool.toolId}': HTTP ${res.status} ${text}`);
    }
  }
}

export class InMemoryToolsService implements ToolsServicePort {
  public readonly registeredTools: CanonicalToolDefinition[] = [];

  public async registerTool(tool: CanonicalToolDefinition, _tenantId?: string): Promise<void> {
    const existingIdx = this.registeredTools.findIndex((t) => t.toolId === tool.toolId);
    if (existingIdx >= 0) {
      this.registeredTools[existingIdx] = tool;
    } else {
      this.registeredTools.push(tool);
    }
  }

  public clear(): void {
    this.registeredTools.length = 0;
  }
}
