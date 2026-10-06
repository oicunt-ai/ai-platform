import type { ToolDefinition, ToolExecutionRequest, ToolSource } from '../../domain/index.js';
import { ToolExecutionFailedError } from '../../domain/index.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolExecutorPort,
} from '../../application/ports/tool-executor.port.js';
import { InternalToolAdapter } from './internal-tool.adapter.js';
import { ServiceToolAdapter } from './service-tool.adapter.js';
import { SandboxToolAdapter } from './sandbox-tool.adapter.js';
import { ExternalApiToolAdapter } from './external-api-tool.adapter.js';
import { McpToolAdapter } from './mcp-tool.adapter.js';

export interface ToolExecutorRouterOptions {
  readonly internalAdapter?: ToolExecutorPort | undefined;
  readonly serviceAdapter?: ToolExecutorPort | undefined;
  readonly sandboxAdapter?: ToolExecutorPort | undefined;
  readonly externalApiAdapter?: ToolExecutorPort | undefined;
  readonly mcpAdapter?: ToolExecutorPort | undefined;
}

export class ToolExecutorRouter implements ToolExecutorPort {
  private readonly adapters = new Map<ToolSource, ToolExecutorPort>();
  private readonly customToolHandlers = new Map<string, ToolExecutorPort>();

  constructor(options: ToolExecutorRouterOptions = {}) {
    this.adapters.set('internal', options.internalAdapter ?? new InternalToolAdapter());
    this.adapters.set('service', options.serviceAdapter ?? new ServiceToolAdapter());
    this.adapters.set('sandbox', options.sandboxAdapter ?? new SandboxToolAdapter());
    this.adapters.set('external_api', options.externalApiAdapter ?? new ExternalApiToolAdapter());
    this.adapters.set('mcp', options.mcpAdapter ?? new McpToolAdapter());
  }

  public registerCustomAdapter(toolId: string, adapter: ToolExecutorPort): void {
    this.customToolHandlers.set(toolId, adapter);
  }

  public async execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput> {
    // Check if custom adapter registered for specific toolId
    const custom = this.customToolHandlers.get(definition.toolId);
    if (custom) {
      return custom.execute(definition, request, context);
    }

    const adapter = this.adapters.get(definition.source);
    if (!adapter) {
      throw new ToolExecutionFailedError(
        `No executor adapter registered for tool source '${definition.source}'`,
        definition.capabilities.isReadOnly,
      );
    }

    return adapter.execute(definition, request, context);
  }
}
