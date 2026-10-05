import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  CanonicalModelId,
  ModelCapabilities,
  ModelLimits,
  ModelModality,
  ModelPricing,
  ModelProviderType,
} from '@oicunt-ai/model-types';
import type {
  AvailabilityStatus,
  DegradationBehavior,
  RoutingStrategy,
} from '../../../domain/index.js';
import { ModelValidationError } from '../../../domain/index.js';
import type {
  CreateCanonicalModelUseCase,
  CreateModelTargetUseCase,
  CreateModelVersionUseCase,
  GetModelUseCase,
  ListModelsUseCase,
  SetModelAliasUseCase,
  UpdateModelTargetStatusUseCase,
  UpdateModelVersionStatusUseCase,
  UpdateRoutingPolicyUseCase,
} from '../../../application/use-cases/index.js';
import { parseJsonBody, type RequestContext } from '../context.js';
import { sendJsonResponse } from '../middleware.js';

export interface CatalogControllerDependencies {
  readonly getModelUseCase: GetModelUseCase;
  readonly listModelsUseCase: ListModelsUseCase;
  readonly createCanonicalModelUseCase: CreateCanonicalModelUseCase;
  readonly createModelVersionUseCase: CreateModelVersionUseCase;
  readonly updateModelVersionStatusUseCase: UpdateModelVersionStatusUseCase;
  readonly createModelTargetUseCase: CreateModelTargetUseCase;
  readonly updateModelTargetStatusUseCase: UpdateModelTargetStatusUseCase;
  readonly updateRoutingPolicyUseCase: UpdateRoutingPolicyUseCase;
  readonly setModelAliasUseCase: SetModelAliasUseCase;
  readonly maxBodySizeBytes?: number | undefined;
}

export class CatalogController {
  constructor(private readonly deps: CatalogControllerDependencies) {}

  public async handleList(res: ServerResponse, context: RequestContext): Promise<void> {
    const models = await this.deps.listModelsUseCase.execute();
    sendJsonResponse(res, 200, models, context);
  }

  public async handleGet(
    res: ServerResponse,
    canonicalModelId: string,
    context: RequestContext,
  ): Promise<void> {
    const model = await this.deps.getModelUseCase.execute(canonicalModelId as CanonicalModelId);
    sendJsonResponse(res, 200, model, context);
  }

  public async handleCreateModel(
    req: IncomingMessage,
    res: ServerResponse,
    context: RequestContext,
  ): Promise<void> {
    this.assertActorId(context);
    const body = await parseJsonBody<{
      id: CanonicalModelId;
      displayName: string;
      description: string;
      activeVersion: string;
    }>(req, this.deps.maxBodySizeBytes);

    const model = await this.deps.createCanonicalModelUseCase.execute({
      id: body.id,
      displayName: body.displayName,
      description: body.description,
      activeVersion: body.activeVersion,
      actorId: context.actorId!,
      correlationId: context.correlationId,
      reason: context.changeReason,
    });

    sendJsonResponse(res, 201, model, context);
  }

  public async handleCreateVersion(
    req: IncomingMessage,
    res: ServerResponse,
    canonicalModelId: string,
    context: RequestContext,
  ): Promise<void> {
    this.assertActorId(context);
    const body = await parseJsonBody<{
      version: string;
      modalities: readonly ModelModality[];
      capabilities: ModelCapabilities;
      limits: ModelLimits;
      pricing: ModelPricing;
      status?: AvailabilityStatus | undefined;
      isImmutable?: boolean | undefined;
    }>(req, this.deps.maxBodySizeBytes);

    const version = await this.deps.createModelVersionUseCase.execute({
      canonicalModelId: canonicalModelId as CanonicalModelId,
      version: body.version,
      modalities: body.modalities,
      capabilities: body.capabilities,
      limits: body.limits,
      pricing: body.pricing,
      status: body.status,
      isImmutable: body.isImmutable,
      actorId: context.actorId!,
      correlationId: context.correlationId,
      reason: context.changeReason,
    });

    sendJsonResponse(res, 201, version, context);
  }

  public async handleUpdateVersionStatus(
    req: IncomingMessage,
    res: ServerResponse,
    canonicalModelId: string,
    version: string,
    context: RequestContext,
  ): Promise<void> {
    this.assertActorId(context);
    this.assertChangeReason(context);
    const body = await parseJsonBody<{ status: AvailabilityStatus }>(
      req,
      this.deps.maxBodySizeBytes,
    );

    const updated = await this.deps.updateModelVersionStatusUseCase.execute({
      canonicalModelId: canonicalModelId as CanonicalModelId,
      version,
      status: body.status,
      actorId: context.actorId!,
      correlationId: context.correlationId,
      reason: context.changeReason,
    });

    sendJsonResponse(res, 200, updated, context);
  }

  public async handleCreateTarget(
    req: IncomingMessage,
    res: ServerResponse,
    canonicalModelId: string,
    context: RequestContext,
  ): Promise<void> {
    this.assertActorId(context);
    const body = await parseJsonBody<{
      id: string;
      modelVersionId: string;
      provider: ModelProviderType;
      upstreamModelId: string;
      priority?: number | undefined;
      weight?: number | undefined;
      region?: string | undefined;
      adapterOptions?: Record<string, unknown> | undefined;
      supportsStreaming?: boolean | undefined;
      status?: AvailabilityStatus | undefined;
      maxConcurrency?: number | undefined;
    }>(req, this.deps.maxBodySizeBytes);

    const target = await this.deps.createModelTargetUseCase.execute({
      id: body.id,
      canonicalModelId: canonicalModelId as CanonicalModelId,
      modelVersionId: body.modelVersionId,
      provider: body.provider,
      upstreamModelId: body.upstreamModelId,
      priority: body.priority,
      weight: body.weight,
      region: body.region,
      adapterOptions: body.adapterOptions,
      supportsStreaming: body.supportsStreaming,
      status: body.status,
      maxConcurrency: body.maxConcurrency,
      actorId: context.actorId!,
      correlationId: context.correlationId,
      reason: context.changeReason,
    });

    sendJsonResponse(res, 201, target, context);
  }

  public async handleUpdateTargetStatus(
    req: IncomingMessage,
    res: ServerResponse,
    canonicalModelId: string,
    targetId: string,
    context: RequestContext,
  ): Promise<void> {
    this.assertActorId(context);
    this.assertChangeReason(context);
    const body = await parseJsonBody<{ status: AvailabilityStatus }>(
      req,
      this.deps.maxBodySizeBytes,
    );

    const updated = await this.deps.updateModelTargetStatusUseCase.execute({
      canonicalModelId: canonicalModelId as CanonicalModelId,
      targetId,
      status: body.status,
      actorId: context.actorId!,
      correlationId: context.correlationId,
      reason: context.changeReason,
    });

    sendJsonResponse(res, 200, updated, context);
  }

  public async handleUpdateRoutingPolicy(
    req: IncomingMessage,
    res: ServerResponse,
    canonicalModelId: string,
    context: RequestContext,
  ): Promise<void> {
    this.assertActorId(context);
    const body = await parseJsonBody<{
      strategy?: RoutingStrategy | undefined;
      maxFallbackAttempts?: number | undefined;
      requireHealthyTarget?: boolean | undefined;
      degradationBehavior?: DegradationBehavior | undefined;
    }>(req, this.deps.maxBodySizeBytes);

    const policy = await this.deps.updateRoutingPolicyUseCase.execute({
      canonicalModelId: canonicalModelId as CanonicalModelId,
      strategy: body.strategy,
      maxFallbackAttempts: body.maxFallbackAttempts,
      requireHealthyTarget: body.requireHealthyTarget,
      degradationBehavior: body.degradationBehavior,
      actorId: context.actorId!,
      correlationId: context.correlationId,
      reason: context.changeReason,
    });

    sendJsonResponse(res, 200, policy, context);
  }

  public async handleSetAlias(
    req: IncomingMessage,
    res: ServerResponse,
    canonicalModelId: string,
    context: RequestContext,
  ): Promise<void> {
    this.assertActorId(context);
    const body = await parseJsonBody<{
      aliasName: string;
      targetVersion: string;
      tenantId?: string | undefined;
    }>(req, this.deps.maxBodySizeBytes);

    const alias = await this.deps.setModelAliasUseCase.execute({
      canonicalModelId: canonicalModelId as CanonicalModelId,
      aliasName: body.aliasName,
      targetVersion: body.targetVersion,
      tenantId: body.tenantId,
      actorId: context.actorId!,
      correlationId: context.correlationId,
      reason: context.changeReason,
    });

    sendJsonResponse(res, 200, alias, context);
  }

  private assertActorId(context: RequestContext): void {
    if (!context.actorId || context.actorId.trim().length === 0) {
      throw new ModelValidationError(
        'X-Actor-ID header is required for administrative mutations',
        'X-Actor-ID',
      );
    }
  }

  private assertChangeReason(context: RequestContext): void {
    if (!context.changeReason || context.changeReason.trim().length === 0) {
      throw new ModelValidationError(
        'X-Change-Reason header is required for status mutations',
        'X-Change-Reason',
      );
    }
  }
}
