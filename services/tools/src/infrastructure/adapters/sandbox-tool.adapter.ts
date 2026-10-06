import type { ToolDefinition, ToolExecutionRequest } from '../../domain/index.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolExecutorPort,
} from '../../application/ports/tool-executor.port.js';

export interface SandboxConfig {
  readonly maxMemoryMb?: number | undefined;
  readonly maxCpuTimeMs?: number | undefined;
}

/**
 * Pluggable delegate interface for future dedicated microVM / container sandbox runners.
 */
export interface SandboxToolRunner {
  run(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<unknown>;
}

/**
 * Adapter boundary for sandboxed tool execution.
 *
 * NOTE: This is strictly an architectural boundary. It intentionally does NOT
 * execute arbitrary Python, Node, shell, or host process commands on the host OS.
 * Real untrusted workloads delegate to a hardened external container/microVM runner.
 */
export class SandboxToolAdapter implements ToolExecutorPort {
  constructor(
    private readonly config: SandboxConfig = {},
    private readonly runner?: SandboxToolRunner | undefined,
  ) {}

  public async execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();

    if (this.runner) {
      const output = await this.runner.run(definition, request, context);
      return {
        executionId: context.executionId,
        callId: request.callId,
        status: 'success',
        output,
        textSummary: `Sandboxed execution of '${definition.toolId}' completed`,
        durationMs: Date.now() - startTime,
      };
    }

    // Safe architectural boundary default without arbitrary code execution
    return {
      executionId: context.executionId,
      callId: request.callId,
      status: 'success',
      output: {
        sandboxed: true,
        toolId: definition.toolId,
        receivedArguments: request.arguments,
        limits: {
          maxMemoryMb: this.config.maxMemoryMb ?? 512,
          maxCpuTimeMs: this.config.maxCpuTimeMs ?? 10000,
        },
      },
      textSummary: `Sandbox boundary for '${definition.toolId}' evaluated successfully`,
      durationMs: Date.now() - startTime,
    };
  }
}
