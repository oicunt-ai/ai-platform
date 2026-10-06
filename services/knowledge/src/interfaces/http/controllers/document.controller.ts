import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DocumentStatus } from '../../../domain/index.js';
import type {
  DeleteDocumentUseCase,
  GetDocumentUseCase,
  ListDocumentsUseCase,
  RegisterDocumentUseCase,
  RetryDocumentUseCase,
} from '../../../application/use-cases/index.js';
import type { RegisterDocumentInputDto } from '../../../application/dtos/document.dto.js';
import type { RequestContext } from '../context.js';
import { validateTenantHeader } from '../auth.js';
import {
  checkDeadline,
  parseJsonBody,
  sendErrorResponse,
  sendJsonResponse,
} from '../middleware.js';

export interface DocumentControllerDependencies {
  readonly registerDocumentUseCase: RegisterDocumentUseCase;
  readonly getDocumentUseCase: GetDocumentUseCase;
  readonly listDocumentsUseCase: ListDocumentsUseCase;
  readonly deleteDocumentUseCase: DeleteDocumentUseCase;
  readonly retryDocumentUseCase: RetryDocumentUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class DocumentController {
  constructor(private readonly deps: DocumentControllerDependencies) {}

  public async handleRegister(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    collectionId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const body = await parseJsonBody<RegisterDocumentInputDto>(req, this.deps.maxBodySizeBytes);

      const document = await this.deps.registerDocumentUseCase.execute(
        tenantId,
        collectionId,
        body,
        {
          userId: context.userId,
          correlationId: context.correlationId,
        },
      );

      sendJsonResponse(res, 202, document, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleList(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    collectionId: string,
    queryParams: URLSearchParams,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const status = (queryParams.get('status') as DocumentStatus) ?? undefined;
      const limitStr = queryParams.get('limit');
      const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
      const offsetStr = queryParams.get('offset');
      const offset = offsetStr ? Number.parseInt(offsetStr, 10) : undefined;

      const result = await this.deps.listDocumentsUseCase.execute(tenantId, collectionId, {
        status,
        limit,
        offset,
      });

      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleGet(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    documentId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const document = await this.deps.getDocumentUseCase.execute(tenantId, documentId);
      sendJsonResponse(res, 200, document, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleDelete(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    documentId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const result = await this.deps.deleteDocumentUseCase.execute(tenantId, documentId);
      sendJsonResponse(res, 200, result, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }

  public async handleRetry(
    _req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
    documentId: string,
  ): Promise<void> {
    try {
      checkDeadline(context);
      const tenantId = validateTenantHeader(context);

      const document = await this.deps.retryDocumentUseCase.execute(tenantId, documentId, {
        correlationId: context.correlationId,
      });

      sendJsonResponse(res, 200, document, context);
    } catch (err) {
      sendErrorResponse(res, err, context);
    }
  }
}
