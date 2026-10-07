import { randomUUID } from 'node:crypto';
import type { McpJsonRpcRequest, McpJsonRpcResponse, McpTool } from '@oicunt-ai/mcp-types';
import type { ToolParametersSchema } from '@oicunt-ai/tool-types';
import type { ToolsServicePort } from '../ports/tools-service.port.js';
import type { McpServerGatewaySession } from '../../domain/server-session.js';
import type { McpCallToolResult } from '../../domain/server-gateway-types.js';
import { sanitizeErrorMessage } from '../../infrastructure/security/error-sanitizer.js';

export interface GatewayRequestContext {
  readonly correlationId: string;
  readonly requestId: string;
  readonly deadlineAt?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class ServerGatewayUseCase {
  constructor(private readonly toolsService: ToolsServicePort) {}

  public async handleRequest(
    rpcReq: McpJsonRpcRequest,
    session: McpServerGatewaySession,
    context: GatewayRequestContext,
  ): Promise<McpJsonRpcResponse | null> {
    const isNotification = rpcReq.id === undefined || rpcReq.id === null;

    if (rpcReq.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: rpcReq.id ?? null,
        error: {
          code: -32600,
          message: "Invalid Request: 'jsonrpc' must be exactly '2.0'",
        },
      };
    }

    session.touch();

    try {
      switch (rpcReq.method) {
        case 'initialize': {
          return this.handleInitialize(rpcReq, session);
        }

        case 'notifications/initialized': {
          session.markActive();
          return null;
        }

        case 'ping': {
          return {
            jsonrpc: '2.0',
            id: rpcReq.id ?? null,
            result: {},
          };
        }

        case 'tools/list': {
          return await this.handleToolsList(rpcReq, session, context);
        }

        case 'tools/call': {
          return await this.handleToolsCall(rpcReq, session, context);
        }

        case 'notifications/cancelled': {
          this.handleCancelled(rpcReq, session);
          return null;
        }

        default: {
          if (isNotification) {
            return null;
          }
          return {
            jsonrpc: '2.0',
            id: rpcReq.id ?? null,
            error: {
              code: -32601,
              message: `Method '${rpcReq.method}' not found`,
            },
          };
        }
      }
    } catch (err: unknown) {
      if (isNotification) {
        return null;
      }

      const safeMessage = sanitizeErrorMessage((err as Error).message);
      return {
        jsonrpc: '2.0',
        id: rpcReq.id ?? null,
        error: {
          code: -32603,
          message: safeMessage,
        },
      };
    }
  }

  private handleInitialize(
    rpcReq: McpJsonRpcRequest,
    session: McpServerGatewaySession,
  ): McpJsonRpcResponse {
    const params = rpcReq.params as Record<string, unknown> | undefined;
    const clientInfo = (params?.['clientInfo'] as
      { name: string; version: string } | undefined) ?? {
      name: 'unknown-client',
      version: '0.0.0',
    };

    session.clientInfo = clientInfo;
    session.protocolVersion = '2024-11-05';
    session.markActive();

    return {
      jsonrpc: '2.0',
      id: rpcReq.id ?? null,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'oicunt-mcp-gateway',
          version: '1.0.0',
        },
      },
    };
  }

  private async handleToolsList(
    rpcReq: McpJsonRpcRequest,
    session: McpServerGatewaySession,
    context: GatewayRequestContext,
  ): Promise<McpJsonRpcResponse> {
    const discovered = await this.toolsService.listTools(
      session.tenantId,
      session.actorId,
      session.roles,
      context.signal,
    );

    const tools: McpTool[] = discovered.map((d) => ({
      name: d.name,
      inputSchema: d.inputSchema as unknown as ToolParametersSchema,
      ...(d.description !== undefined ? { description: d.description } : {}),
    }));

    return {
      jsonrpc: '2.0',
      id: rpcReq.id ?? null,
      result: { tools },
    };
  }

  private async handleToolsCall(
    rpcReq: McpJsonRpcRequest,
    session: McpServerGatewaySession,
    context: GatewayRequestContext,
  ): Promise<McpJsonRpcResponse> {
    const params = rpcReq.params as Record<string, unknown> | undefined;
    const toolName = params?.['name'];

    if (!toolName || typeof toolName !== 'string' || !toolName.trim()) {
      return {
        jsonrpc: '2.0',
        id: rpcReq.id ?? null,
        error: {
          code: -32602,
          message: "Invalid params: 'name' is required for tools/call",
        },
      };
    }

    const rawArgs =
      params?.['arguments'] &&
      typeof params['arguments'] === 'object' &&
      !Array.isArray(params['arguments'])
        ? { ...(params['arguments'] as Record<string, unknown>) }
        : {};
    const meta =
      params?.['_meta'] && typeof params['_meta'] === 'object' && !Array.isArray(params['_meta'])
        ? (params['_meta'] as Record<string, unknown>)
        : {};

    // Extract confirmation token if provided in arguments._confirmationToken or _meta
    let confirmationToken: string | undefined;

    if ('_confirmationToken' in rawArgs) {
      const candidate = rawArgs['_confirmationToken'];
      if (typeof candidate === 'string' && candidate.trim()) {
        confirmationToken = candidate.trim();
      }
      delete rawArgs['_confirmationToken'];
    }

    if (!confirmationToken) {
      const metaCandidate = meta['_confirmationToken'] ?? meta['confirmationToken'];
      if (typeof metaCandidate === 'string' && metaCandidate.trim()) {
        confirmationToken = metaCandidate.trim();
      }
    }

    const cleanArgs = rawArgs;

    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const outcome = await this.toolsService.executeTool({
      toolId: toolName.trim(),
      callId,
      arguments: cleanArgs,
      tenantId: session.tenantId,
      userId: session.userId,
      actorId: session.actorId,
      roles: session.roles,
      correlationId: context.correlationId,
      requestId: context.requestId,
      deadlineAt: context.deadlineAt,
      deadlineMs: context.deadlineMs,
      confirmationToken,
      signal: context.signal,
    });

    if (outcome.status === 'confirmation_required' && outcome.challenge) {
      const callResult: McpCallToolResult = {
        content: [
          {
            type: 'text',
            text: `Action requires human confirmation: Tool '${outcome.challenge.toolId}' is confirmation-gated. Re-submit tools/call with the confirmationToken.`,
          },
        ],
        isError: true,
        _confirmationChallenge: {
          status: 'confirmation_required',
          challengeToken: outcome.challenge.challengeToken,
          toolId: outcome.challenge.toolId,
          expiresAt: outcome.challenge.expiresAt,
          confirmationId: outcome.challenge.confirmationId,
        },
      };

      return {
        jsonrpc: '2.0',
        id: rpcReq.id ?? null,
        result: callResult,
      };
    }

    if (outcome.status === 'failure') {
      const safeMessage = sanitizeErrorMessage(outcome.error?.message ?? 'Tool execution failed');
      const callResult: McpCallToolResult = {
        content: [
          {
            type: 'text',
            text: safeMessage,
          },
        ],
        isError: true,
      };

      return {
        jsonrpc: '2.0',
        id: rpcReq.id ?? null,
        result: callResult,
      };
    }

    // Success outcome
    let textRepresentation: string;
    if (outcome.textSummary) {
      textRepresentation = outcome.textSummary;
    } else if (typeof outcome.output === 'string') {
      textRepresentation = outcome.output;
    } else {
      textRepresentation = JSON.stringify(outcome.output ?? {}, null, 2);
    }

    const callResult: McpCallToolResult = {
      content: [
        {
          type: 'text',
          text: textRepresentation,
        },
      ],
      isError: false,
    };

    return {
      jsonrpc: '2.0',
      id: rpcReq.id ?? null,
      result: callResult,
    };
  }

  private handleCancelled(rpcReq: McpJsonRpcRequest, session: McpServerGatewaySession): void {
    const params = rpcReq.params as Record<string, unknown> | undefined;
    const targetId = params?.['requestId'];
    if (typeof targetId === 'string' || typeof targetId === 'number') {
      session.cancelRequest(
        targetId,
        (params?.['reason'] as string | undefined) ?? 'Client cancelled request',
      );
    }
  }
}
