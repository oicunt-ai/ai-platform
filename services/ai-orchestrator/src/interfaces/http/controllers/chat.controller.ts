import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CoordinateChatTurnUseCase } from '../../../application/use-cases/coordinate-chat-turn.use-case.js';
import type { OrchestratorChatRequest } from '../../../application/dtos/chat.dto.js';
import { RequestCancelledError } from '../../../domain/errors.js';
import type { RequestContext } from '../context.js';
import { parseJsonBody, sendErrorResponse, sendJsonResponse } from '../middleware.js';

export interface ChatControllerDependencies {
  readonly coordinateChatTurnUseCase: CoordinateChatTurnUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class ChatController {
  private readonly useCase: CoordinateChatTurnUseCase;
  private readonly maxBodySizeBytes: number;

  constructor(deps: ChatControllerDependencies) {
    this.useCase = deps.coordinateChatTurnUseCase;
    this.maxBodySizeBytes = deps.maxBodySizeBytes ?? 10485760; // 10MB default
  }

  public async handleChat(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    const abortController = new AbortController();

    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort(
          new RequestCancelledError('Client closed connection', context.correlationId),
        );
      }
    });

    try {
      const rawBody = await parseJsonBody<OrchestratorChatRequest>(req, this.maxBodySizeBytes);

      const isStream =
        Boolean(rawBody.stream) || (req.headers['accept']?.includes('text/event-stream') ?? false);

      const request: OrchestratorChatRequest = {
        ...rawBody,
        stream: isStream,
      };

      if (isStream) {
        await this.handleStream(res, request, context, abortController);
      } else {
        await this.handleUnary(res, request, context, abortController);
      }
    } catch (err: unknown) {
      if (!res.headersSent) {
        sendErrorResponse(res, err, context);
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }

  private async handleUnary(
    res: ServerResponse,
    request: OrchestratorChatRequest,
    context: RequestContext,
    abortController: AbortController,
  ): Promise<void> {
    const response = await this.useCase.executeUnary(request, context, abortController.signal);

    sendJsonResponse(res, 200, response.data, context);
  }

  private async handleStream(
    res: ServerResponse,
    request: OrchestratorChatRequest,
    context: RequestContext,
    abortController: AbortController,
  ): Promise<void> {
    let headersWritten = false;

    try {
      const stream = this.useCase.executeStream(request, context, abortController.signal);

      for await (const event of stream) {
        if (!headersWritten) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Request-ID': context.requestId,
            'X-Correlation-ID': context.correlationId,
          });
          headersWritten = true;
        }

        if (res.writableEnded) {
          break;
        }

        res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      }
    } catch (err: unknown) {
      if (!headersWritten) {
        sendErrorResponse(res, err, context);
        return;
      }

      if (!res.writableEnded) {
        const errorMsg = err instanceof Error ? err.message : 'Streaming execution failed';
        res.write(
          `event: error\ndata: ${JSON.stringify({ code: 'STREAM_INTERRUPTED', message: errorMsg })}\n\n`,
        );
      }
    } finally {
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
