import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecuteInferenceUseCase } from '../../../application/use-cases/execute-inference.use-case.js';
import type { InferenceExecutionRequest } from '../../../application/dtos/inference-execution.dto.js';
import { RequestCancelledError } from '../../../domain/errors.js';
import type { RequestContext } from '../context.js';
import { parseJsonBody, sendErrorResponse, sendJsonResponse } from '../middleware.js';

export interface InferenceControllerDependencies {
  readonly executeInferenceUseCase: ExecuteInferenceUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class InferenceController {
  private readonly useCase: ExecuteInferenceUseCase;
  private readonly maxBodySizeBytes: number;

  constructor(deps: InferenceControllerDependencies) {
    this.useCase = deps.executeInferenceUseCase;
    this.maxBodySizeBytes = deps.maxBodySizeBytes ?? 10_485_760; // 10MB
  }

  public async handleExecute(
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
      const rawBody = await parseJsonBody<InferenceExecutionRequest>(req, this.maxBodySizeBytes);

      const isStream =
        Boolean(rawBody.stream) || (req.headers['accept']?.includes('text/event-stream') ?? false);

      const request: InferenceExecutionRequest = {
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
    request: InferenceExecutionRequest,
    context: RequestContext,
    abortController: AbortController,
  ): Promise<void> {
    const response = await this.useCase.executeUnary(request, context, abortController.signal);
    sendJsonResponse(res, 200, response.data, context);
  }

  private async handleStream(
    res: ServerResponse,
    request: InferenceExecutionRequest,
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

        const sseChunk = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
        res.write(sseChunk);
      }

      if (!res.writableEnded) {
        res.end();
      }
    } catch (err: unknown) {
      if (!headersWritten) {
        sendErrorResponse(res, err, context);
      } else if (!res.writableEnded) {
        const errorPayload = {
          code: 'STREAM_ERROR',
          message: err instanceof Error ? err.message : String(err),
        };
        res.write(`event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`);
        res.end();
      }
    }
  }
}
