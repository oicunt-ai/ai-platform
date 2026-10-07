import type { ExecuteMcpToolDto, ExecuteMcpToolResultDto } from '../dtos/mcp.dto.js';
import {
  McpConnectionError,
  McpExecutionError,
  McpInvalidRequestError,
  McpServerNotFoundError,
  McpTimeoutError,
} from '../../domain/errors.js';
import { buildCanonicalToolId } from '../../domain/values/identity.js';
import type { McpServerRepositoryPort } from '../ports/mcp-server-repository.port.js';
import type { McpClientRuntimePort } from '../ports/mcp-client-runtime.port.js';

interface RawCallToolResult {
  readonly content?: readonly unknown[] | undefined;
  readonly isError?: boolean | undefined;
}

export class ExecuteToolUseCase {
  constructor(
    private readonly repository: McpServerRepositoryPort,
    private readonly clientRuntime: McpClientRuntimePort,
  ) {}

  public async execute(dto: ExecuteMcpToolDto): Promise<ExecuteMcpToolResultDto> {
    const startTime = Date.now();

    if (!dto.serverId?.trim()) {
      throw new McpInvalidRequestError('serverId is required');
    }
    if (!dto.toolName?.trim()) {
      throw new McpInvalidRequestError('toolName is required');
    }
    if (!dto.tenantId?.trim()) {
      throw new McpInvalidRequestError('tenantId is required');
    }

    // 1. Verify server registration & tenant isolation
    const server = await this.repository.findById(dto.serverId.trim(), dto.tenantId.trim());
    if (!server) {
      throw new McpServerNotFoundError(dto.serverId);
    }

    // 2. Verify tool exists in catalog
    const canonicalToolId = buildCanonicalToolId(dto.serverId, dto.toolName);
    const toolDescriptor = await this.repository.findTool(canonicalToolId);
    if (!toolDescriptor || !toolDescriptor.isActive) {
      throw new McpInvalidRequestError(
        `Tool '${dto.toolName}' is not registered or is inactive on server '${dto.serverId}'`,
      );
    }

    // 3. Acquire active session
    const transport = await this.clientRuntime.getOrCreateSession(server.serverId, server.tenantId);

    // 4. Deadline / cancellation handling
    const abortController = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    if (dto.deadlineMs && dto.deadlineMs > 0) {
      const now = Date.now();
      const remainingMs = Math.max(1, dto.deadlineMs - now);
      timeoutId = setTimeout(() => {
        abortController.abort(
          new McpTimeoutError(`Execution deadline of ${dto.deadlineMs}ms exceeded`),
        );
      }, remainingMs);
    }

    if (dto.signal) {
      dto.signal.addEventListener('abort', () => {
        abortController.abort(dto.signal?.reason);
      });
    }

    try {
      const rawResult = await transport.sendRequest<RawCallToolResult>(
        'tools/call',
        {
          name: dto.toolName,
          arguments: dto.arguments ?? {},
        },
        {
          signal: abortController.signal,
          deadlineMs: dto.deadlineMs,
        },
      );

      const durationMs = Date.now() - startTime;
      const content = rawResult?.content ?? [];
      const isError = Boolean(rawResult?.isError);

      return {
        content,
        isError,
        durationMs,
      };
    } catch (err: unknown) {
      // If client aborted, notify MCP server
      if (abortController.signal.aborted) {
        try {
          await transport.sendNotification('notifications/cancelled', {
            requestId: dto.correlationId ?? 'unknown',
            reason: 'Caller cancelled request',
          });
        } catch {
          // Ignore cancellation emission failure
        }
      }

      if (err instanceof McpTimeoutError) {
        throw err;
      }
      if (err instanceof McpConnectionError) {
        throw err;
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new McpExecutionError(
        `Failed to execute tool '${dto.toolName}' on server '${dto.serverId}': ${errorMsg}`,
        false,
        err,
      );
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
