import type { ToolDefinition, ToolExecutionRequest } from '../../domain/index.js';
import type {
  ToolExecutionContext,
  ToolExecutionOutput,
  ToolExecutorPort,
} from '../../application/ports/tool-executor.port.js';

export class MockToolAdapter implements ToolExecutorPort {
  private customHandlers = new Map<
    string,
    (
      req: ToolExecutionRequest,
      ctx: ToolExecutionContext,
      def: ToolDefinition,
    ) => Promise<unknown> | unknown
  >();

  public setHandler(
    toolId: string,
    handler: (
      req: ToolExecutionRequest,
      ctx: ToolExecutionContext,
      def: ToolDefinition,
    ) => Promise<unknown> | unknown,
  ): void {
    this.customHandlers.set(toolId, handler);
  }

  public removeHandler(toolId: string): void {
    this.customHandlers.delete(toolId);
  }

  public async execute(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();
    const handler = this.customHandlers.get(definition.toolId);

    if (handler) {
      const output = await handler(request, context, definition);
      return {
        executionId: context.executionId,
        callId: request.callId,
        status: 'success',
        output,
        textSummary: `Mock execution of '${definition.toolId}' completed`,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      executionId: context.executionId,
      callId: request.callId,
      status: 'success',
      output: { mockExecuted: true, toolId: definition.toolId, arguments: request.arguments },
      textSummary: `Mock tool '${definition.toolId}' executed successfully`,
      durationMs: Date.now() - startTime,
    };
  }
}
