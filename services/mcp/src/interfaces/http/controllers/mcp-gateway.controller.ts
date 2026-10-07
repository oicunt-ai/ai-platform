import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpJsonRpcRequest, McpJsonRpcResponse } from '@oicunt-ai/mcp-types';
import type { RequestContext } from '../context.js';
import type { ServerGatewayUseCase } from '../../../application/use-cases/server-gateway.use-case.js';
import type { McpGatewaySessionStorePort } from '../../../application/ports/mcp-gateway-session-store.port.js';
import type { PerimeterAuthPort } from '../../../application/ports/perimeter-auth.port.js';
import type { McpConfig } from '../../../config.js';
import type { JsonLogger } from '../../../infrastructure/logging/logger.js';
import { McpServerGatewaySession } from '../../../domain/server-session.js';
import { extractHeader } from '../context.js';

export interface McpGatewayControllerDependencies {
  readonly serverGatewayUseCase: ServerGatewayUseCase;
  readonly sessionStore: McpGatewaySessionStorePort;
  readonly perimeterAuth: PerimeterAuthPort;
  readonly config: McpConfig;
  readonly logger?: JsonLogger | undefined;
}

export class McpGatewayController {
  private readonly serverGatewayUseCase: ServerGatewayUseCase;
  private readonly sessionStore: McpGatewaySessionStorePort;
  private readonly perimeterAuth: PerimeterAuthPort;
  private readonly config: McpConfig;
  private readonly logger?: JsonLogger | undefined;

  constructor(dependencies: McpGatewayControllerDependencies) {
    this.serverGatewayUseCase = dependencies.serverGatewayUseCase;
    this.sessionStore = dependencies.sessionStore;
    this.perimeterAuth = dependencies.perimeterAuth;
    this.config = dependencies.config;
    this.logger = dependencies.logger;
  }

  public async handleMcpPost(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    // 1. Guard against oversized payloads
    const contentLengthHeader = req.headers['content-length'];
    if (contentLengthHeader) {
      const parsedLength = Number.parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(parsedLength) && parsedLength > this.config.maxRequestSizeBytes) {
        this.sendHttpError(res, 413, 'PAYLOAD_TOO_LARGE', 'Payload exceeds maximum allowed size');
        return;
      }
    }

    // 2. Read body safely with size cap
    let rawBody: string;
    try {
      rawBody = await this.readBody(req, this.config.maxRequestSizeBytes);
    } catch (_err) {
      this.sendHttpError(
        res,
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body exceeded maximum allowed limit',
      );
      return;
    }

    // 3. Parse JSON-RPC payload
    let rpcBody: McpJsonRpcRequest;
    try {
      rpcBody = JSON.parse(rawBody);
    } catch (_err) {
      this.sendJsonRpcResponse(res, null, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON was received by the server',
        },
      });
      return;
    }

    if (
      !rpcBody ||
      typeof rpcBody !== 'object' ||
      Array.isArray(rpcBody) ||
      rpcBody.jsonrpc !== '2.0'
    ) {
      const candidateId =
        typeof rpcBody === 'object' && rpcBody !== null && 'id' in rpcBody
          ? ((rpcBody as { id?: string | number | null }).id ?? null)
          : null;
      this.sendJsonRpcResponse(res, null, {
        jsonrpc: '2.0',
        id: candidateId,
        error: {
          code: -32600,
          message: "Invalid Request: Payload must be a JSON-RPC 2.0 object with jsonrpc='2.0'",
        },
      });
      return;
    }

    // 4. Session resolution & Authentication perimeter
    const sessionIdHeader = extractHeader(req, 'mcp-session-id');
    let session: McpServerGatewaySession;

    if (rpcBody.method === 'initialize') {
      try {
        const auth = await this.perimeterAuth.authenticate(req, context);
        const newSessionId = `mcp_sess_${randomUUID().replace(/-/g, '')}`;
        session = new McpServerGatewaySession({
          sessionId: newSessionId,
          tenantId: auth.tenantId,
          userId: auth.userId,
          actorId: auth.actorId,
          roles: auth.roles,
          clientInfo: { name: 'unknown', version: '0.0.0' },
          hardExpiresAt: Date.now() + this.config.serverSessionMaxTtlMs,
        });

        await this.sessionStore.create(session);
        this.logger?.info('Created new MCP server gateway session', {
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          actorId: session.actorId,
        });
      } catch (err: unknown) {
        this.sendJsonRpcResponse(res, null, {
          jsonrpc: '2.0',
          id: rpcBody.id ?? null,
          error: {
            code: -32003,
            message: (err as Error).message || 'Perimeter authentication failed',
          },
        });
        return;
      }
    } else {
      if (!sessionIdHeader) {
        this.sendJsonRpcResponse(res, null, {
          jsonrpc: '2.0',
          id: rpcBody.id ?? null,
          error: {
            code: -32003,
            message: 'Unauthorized: Missing mandatory Mcp-Session-Id header',
          },
        });
        return;
      }

      const existingSession = await this.sessionStore.get(sessionIdHeader);
      if (!existingSession) {
        this.sendJsonRpcResponse(res, null, {
          jsonrpc: '2.0',
          id: rpcBody.id ?? null,
          error: {
            code: -32003,
            message: 'Unauthorized: Session expired or invalid. Please re-initialize.',
          },
        });
        return;
      }
      session = existingSession;

      // Security Check: Block client-supplied spoofed tenant header
      const clientTenantHeader = extractHeader(req, 'x-tenant-id');
      if (clientTenantHeader && clientTenantHeader !== session.tenantId) {
        this.logger?.warn('Security alert: Cross-tenant session mismatch attempted', {
          sessionId: session.sessionId,
          expectedTenant: session.tenantId,
          attemptedTenant: clientTenantHeader,
        });
        this.sendJsonRpcResponse(res, session.sessionId, {
          jsonrpc: '2.0',
          id: rpcBody.id ?? null,
          error: {
            code: -32003,
            message: 'Cross-tenant session access rejected',
          },
        });
        return;
      }
    }

    // 5. Cancellation & In-flight tracking setup
    const requestController = new AbortController();
    const abortListener = () => {
      requestController.abort(new Error('Downstream connection closed or client aborted'));
    };

    context.signal.addEventListener('abort', abortListener);

    if (rpcBody.id !== undefined && rpcBody.id !== null) {
      session.registerRequest(rpcBody.id, requestController);
    }

    // 6. Dispatch to gateway use case
    try {
      const response = await this.serverGatewayUseCase.handleRequest(rpcBody, session, {
        correlationId: context.correlationId,
        requestId: context.requestId,
        deadlineAt: extractHeader(req, 'x-deadline-at'),
        deadlineMs: context.deadlineMs,
        signal: requestController.signal,
      });

      if (response === null) {
        // Notification - respond with 204 No Content
        res.writeHead(204, {
          'Mcp-Session-Id': session.sessionId,
          'X-Correlation-ID': context.correlationId,
          'X-Request-ID': context.requestId,
        });
        res.end();
        return;
      }

      this.sendJsonRpcResponse(res, session.sessionId, response, context);
    } finally {
      context.signal.removeEventListener('abort', abortListener);
      if (rpcBody.id !== undefined && rpcBody.id !== null) {
        session.unregisterRequest(rpcBody.id);
      }
    }
  }

  private readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let totalBytes = 0;
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          req.destroy();
          reject(new Error('Payload too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }

  private sendJsonRpcResponse(
    res: ServerResponse,
    sessionId: string | null,
    rpcResponse: McpJsonRpcResponse,
    context?: RequestContext,
  ): void {
    const jsonStr = JSON.stringify(rpcResponse);
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(jsonStr),
    };

    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }
    if (context) {
      headers['X-Correlation-ID'] = context.correlationId;
      headers['X-Request-ID'] = context.requestId;
    }

    res.writeHead(200, headers);
    res.end(jsonStr);
  }

  private sendHttpError(
    res: ServerResponse,
    statusCode: number,
    code: string,
    message: string,
  ): void {
    const errorBody = JSON.stringify({
      success: false,
      error: { code, message },
    });

    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(errorBody),
    });
    res.end(errorBody);
  }
}
