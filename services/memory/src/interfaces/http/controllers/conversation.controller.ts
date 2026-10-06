import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConversationStatus } from '../../../domain/index.js';
import type {
  CreateConversationUseCase,
  DeleteConversationUseCase,
  GetConversationUseCase,
  ListConversationsUseCase,
  UpdateConversationUseCase,
} from '../../../application/use-cases/index.js';
import type {
  CreateConversationRequestDto,
  UpdateConversationRequestDto,
} from '../../../application/dtos/conversation.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader, validateUserHeader } from '../auth.js';
import {
  checkDeadline,
  parseJsonBody,
  sendErrorResponse,
  sendJsonResponse,
} from '../middleware.js';

export interface ConversationControllerDependencies {
  readonly createConversationUseCase: CreateConversationUseCase;
  readonly getConversationUseCase: GetConversationUseCase;
  readonly listConversationsUseCase: ListConversationsUseCase;
  readonly updateConversationUseCase: UpdateConversationUseCase;
  readonly deleteConversationUseCase: DeleteConversationUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class ConversationController {
  constructor(private readonly deps: ConversationControllerDependencies) {}

  public async handleCreate(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);
      const userId = validateUserHeader(context);

      const body = await parseJsonBody<CreateConversationRequestDto>(
        req,
        this.deps.maxBodySizeBytes,
      );

      const conversation = await this.deps.createConversationUseCase.execute(body, {
        tenantId,
        userId,
        signal: context.signal,
      });

      sendJsonResponse(res, 201, conversation, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleGet(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    conversationId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const conversation = await this.deps.getConversationUseCase.execute(conversationId, {
        tenantId,
        userId: context.userId,
        callerServiceName: context.serviceName,
        signal: context.signal,
      });

      sendJsonResponse(res, 200, conversation, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleList(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    queryParams: URLSearchParams,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const userId = queryParams.get('userId') ?? undefined;
      const status = (queryParams.get('status') as ConversationStatus | 'all') ?? undefined;
      const limitStr = queryParams.get('limit');
      const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
      const order = (queryParams.get('order') as 'asc' | 'desc') ?? undefined;

      const result = await this.deps.listConversationsUseCase.execute(
        {
          userId,
          status,
          limit,
          order,
        },
        {
          tenantId,
          userId: context.userId,
          callerServiceName: context.serviceName,
          signal: context.signal,
        },
      );

      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleUpdate(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    conversationId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const body = await parseJsonBody<UpdateConversationRequestDto>(
        req,
        this.deps.maxBodySizeBytes,
      );

      const conversation = await this.deps.updateConversationUseCase.execute(conversationId, body, {
        tenantId,
        userId: context.userId,
        callerServiceName: context.serviceName,
        signal: context.signal,
      });

      sendJsonResponse(res, 200, conversation, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleDelete(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    conversationId: string,
    queryParams: URLSearchParams,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);
      const hard = queryParams.get('hard') === 'true';

      const result = await this.deps.deleteConversationUseCase.execute(conversationId, {
        tenantId,
        userId: context.userId,
        callerServiceName: context.serviceName,
        hard,
        signal: context.signal,
      });

      sendJsonResponse(
        res,
        200,
        {
          deleted: true,
          conversationId: result.conversationId,
          hard: result.hard,
        },
        context,
      );
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
