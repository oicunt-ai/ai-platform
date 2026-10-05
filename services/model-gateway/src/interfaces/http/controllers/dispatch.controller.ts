import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DispatchModelUseCase } from '../../../application/use-cases/dispatch-model.use-case.js';
import type { GatewayDispatchPayload } from '../../../application/dtos/dispatch.dto.js';
import type { RequestContext } from '../context.js';
import { parseJsonBody, sendErrorResponse, sendJsonResponse } from '../middleware.js';

export interface DispatchControllerDependencies {
  readonly dispatchUseCase: DispatchModelUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class DispatchController {
  private readonly dispatchUseCase: DispatchModelUseCase;
  private readonly maxBodySizeBytes: number;

  constructor(deps: DispatchControllerDependencies) {
    this.dispatchUseCase = deps.dispatchUseCase;
    this.maxBodySizeBytes = deps.maxBodySizeBytes ?? 1048576;
  }

  public async handleDispatch(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    try {
      const rawBody = await parseJsonBody<GatewayDispatchPayload>(req, this.maxBodySizeBytes);

      // Merge context metadata
      const payload: GatewayDispatchPayload = {
        ...rawBody,
        requestId: context.requestId,
        correlationId: context.correlationId,
        actorId: context.actorId ?? rawBody.actorId ?? 'system',
        userId: context.userId ?? rawBody.userId,
        tenantId: context.tenantId ?? rawBody.tenantId,
      };

      if (payload.stream) {
        await this.handleStreamDispatch(req, res, payload, context);
      } else {
        await this.handleUnaryDispatch(req, res, payload, context);
      }
    } catch (err: unknown) {
      if (!res.headersSent) {
        sendErrorResponse(res, err, context);
      } else {
        res.end();
      }
    }
  }

  private async handleUnaryDispatch(
    req: IncomingMessage,
    res: ServerResponse,
    payload: GatewayDispatchPayload,
    context: RequestContext,
  ): Promise<void> {
    const abortController = new AbortController();

    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort(new Error('Client connection closed'));
      }
    });

    const result = await this.dispatchUseCase.executeUnary(payload, abortController.signal);
    sendJsonResponse(res, 200, result, context);
  }

  private async handleStreamDispatch(
    req: IncomingMessage,
    res: ServerResponse,
    payload: GatewayDispatchPayload,
    context: RequestContext,
  ): Promise<void> {
    const abortController = new AbortController();

    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort(new Error('Client connection closed'));
      }
    });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Request-ID': context.requestId,
      'X-Correlation-ID': context.correlationId,
    });

    try {
      const stream = this.dispatchUseCase.executeStream(payload, abortController.signal);

      for await (const event of stream) {
        if (res.writableEnded) {
          break;
        }
        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (err: unknown) {
      if (!res.writableEnded) {
        const message = err instanceof Error ? err.message : 'Streaming execution failed';
        res.write(
          `event: error\ndata: ${JSON.stringify({ code: 'STREAM_INTERRUPTED', message })}\n\n`,
        );
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
