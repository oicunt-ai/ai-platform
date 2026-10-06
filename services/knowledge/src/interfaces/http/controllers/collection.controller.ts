import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CreateCollectionUseCase,
  DeleteCollectionUseCase,
  GetCollectionUseCase,
  ListCollectionsUseCase,
} from '../../../application/use-cases/index.js';
import type { CreateCollectionInputDto } from '../../../application/dtos/collection.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import {
  checkDeadline,
  parseJsonBody,
  sendErrorResponse,
  sendJsonResponse,
} from '../middleware.js';

export interface CollectionControllerDependencies {
  readonly createCollectionUseCase: CreateCollectionUseCase;
  readonly getCollectionUseCase: GetCollectionUseCase;
  readonly listCollectionsUseCase: ListCollectionsUseCase;
  readonly deleteCollectionUseCase: DeleteCollectionUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class CollectionController {
  constructor(private readonly deps: CollectionControllerDependencies) {}

  public async handleCreate(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const body = await parseJsonBody<CreateCollectionInputDto>(req, this.deps.maxBodySizeBytes);

      const collection = await this.deps.createCollectionUseCase.execute(tenantId, body);
      sendJsonResponse(res, 201, collection, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleList(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const collections = await this.deps.listCollectionsUseCase.execute(tenantId);
      sendJsonResponse(res, 200, collections, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleGet(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    collectionId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const collection = await this.deps.getCollectionUseCase.execute(tenantId, collectionId);
      sendJsonResponse(res, 200, collection, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleDelete(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    collectionId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      await this.deps.deleteCollectionUseCase.execute(tenantId, collectionId);
      sendJsonResponse(
        res,
        200,
        {
          collectionId,
          deleted: true,
        },
        context,
      );
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
