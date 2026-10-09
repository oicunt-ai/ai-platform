import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModelRegistryPort } from '../../../application/ports/model-registry.port.js';
import type { MemoryCallContext, MemoryPort } from '../../../application/ports/memory.port.js';
import type { RequestContext } from '../context.js';
import { parseJsonBody, sendErrorResponse, sendJsonResponse } from '../middleware.js';

export class ResourcesController {
  constructor(
    private readonly registry: ModelRegistryPort,
    private readonly memory: MemoryPort,
  ) {}

  async catalog(res: ServerResponse, context: RequestContext): Promise<void> {
    try {
      if (!context.tenantId || !this.registry.getCatalog) throw new Error('Catalog unavailable');
      sendJsonResponse(
        res,
        200,
        await this.registry.getCatalog(
          { tenantId: context.tenantId, correlationId: context.correlationId },
          undefined,
        ),
        context,
      );
    } catch (error) {
      sendErrorResponse(res, error, context);
    }
  }

  async conversations(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    try {
      const callContext = this.memoryContext(context);
      if (req.method === 'POST') {
        if (!this.memory.createConversation) throw new Error('Conversation creation unavailable');
        sendJsonResponse(
          res,
          201,
          await this.memory.createConversation(await parseJsonBody(req), callContext),
          context,
        );
        return;
      }
      if (!this.memory.listConversations) throw new Error('Conversation listing unavailable');
      sendJsonResponse(res, 200, await this.memory.listConversations(callContext), context);
    } catch (error) {
      sendErrorResponse(res, error, context);
    }
  }

  async messages(
    res: ServerResponse,
    context: RequestContext,
    conversationId: string,
  ): Promise<void> {
    try {
      if (!this.memory.listMessages) throw new Error('Message listing unavailable');
      sendJsonResponse(
        res,
        200,
        await this.memory.listMessages(conversationId, this.memoryContext(context)),
        context,
      );
    } catch (error) {
      sendErrorResponse(res, error, context);
    }
  }

  private memoryContext(context: RequestContext): MemoryCallContext {
    if (!context.tenantId || !context.userId)
      throw new Error('Tenant and user context are required');
    return {
      tenantId: context.tenantId,
      userId: context.userId,
      actorId: context.actorId,
      requestId: context.requestId,
      correlationId: context.correlationId,
    };
  }
}
