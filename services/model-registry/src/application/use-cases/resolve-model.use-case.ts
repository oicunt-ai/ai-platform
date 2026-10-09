import type {
  ModelResolutionRequest,
  ModelResolutionResponse,
  ResolvedTargetDto,
} from '../dtos/resolution.dto.js';
import type { ModelRepositoryPort } from '../ports/model-repository.port.js';
import type { ModelCachePort } from '../ports/model-cache.port.js';
import {
  ModelDeprecatedError,
  ModelInMaintenanceError,
  ModelNotFoundError,
  ModelValidationError,
  UnsupportedEffortError,
  CANONICAL_MODEL_ID_REGEX,
} from '../../domain/index.js';

export interface ResolveModelUseCaseOptions {
  readonly defaultCacheTtlSeconds?: number | undefined;
}

export class ResolveModelUseCase {
  private readonly defaultCacheTtlSeconds: number;

  constructor(
    private readonly modelRepository: ModelRepositoryPort,
    private readonly cache: ModelCachePort,
    options: ResolveModelUseCaseOptions = {},
  ) {
    this.defaultCacheTtlSeconds = options.defaultCacheTtlSeconds ?? 60;
  }

  public async execute(request: ModelResolutionRequest): Promise<ModelResolutionResponse> {
    // -------------------------------------------------------------
    // STEP 1: Request Validation
    // -------------------------------------------------------------
    if (
      !request.canonicalModelId ||
      typeof request.canonicalModelId !== 'string' ||
      !CANONICAL_MODEL_ID_REGEX.test(request.canonicalModelId)
    ) {
      throw new ModelValidationError(
        `Invalid canonical model ID '${request.canonicalModelId}'. Expected an OICUNT catalog ID such as 'oicunt.model.catalog-model'`,
        'canonicalModelId',
      );
    }

    if (!request.correlationId || typeof request.correlationId !== 'string') {
      throw new ModelValidationError('Correlation ID is required', 'correlationId');
    }

    // Cache lookup key
    const versionKey = request.version?.trim() || 'active';
    const effortKey = request.effort?.trim() || 'default';
    const tenantKey = request.tenantId?.trim() || 'global';
    const cacheKey = `${request.canonicalModelId}:${versionKey}:${effortKey}:${tenantKey}`;

    const cached = await this.cache.getResolution(cacheKey);
    if (cached) {
      return cached;
    }

    // -------------------------------------------------------------
    // STEP 2: Canonical Model Lookup
    // -------------------------------------------------------------
    const model = await this.modelRepository.findById(request.canonicalModelId);
    if (!model) {
      throw new ModelNotFoundError(request.canonicalModelId);
    }

    // -------------------------------------------------------------
    // STEP 3: Version and Alias Resolution
    // -------------------------------------------------------------
    const resolvedVersion = model.resolveVersion(request.version, request.tenantId);

    // -------------------------------------------------------------
    // STEP 4: Availability Validation
    // -------------------------------------------------------------
    if (resolvedVersion.status === 'maintenance') {
      throw new ModelInMaintenanceError(model.id, resolvedVersion.version);
    }
    if (resolvedVersion.status === 'deprecated') {
      throw new ModelDeprecatedError(model.id, resolvedVersion.version);
    }

    // -------------------------------------------------------------
    // STEP 4.5: Effort Capability Validation
    // -------------------------------------------------------------
    let effectiveEffort = request.effort;
    if (request.effort) {
      const supported = resolvedVersion.capabilities.supportedEffortLevels ?? [];
      if (!resolvedVersion.capabilities.reasoning || !supported.includes(request.effort)) {
        throw new UnsupportedEffortError(
          model.id,
          resolvedVersion.version,
          request.effort,
          supported,
        );
      }
    } else if (
      resolvedVersion.capabilities.reasoning &&
      resolvedVersion.capabilities.defaultEffortLevel
    ) {
      effectiveEffort = resolvedVersion.capabilities.defaultEffortLevel;
    }

    // -------------------------------------------------------------
    // STEP 5: Eligible Target Filtering & Deterministic Ordering
    // -------------------------------------------------------------
    const allowDegraded = model.routingPolicy.strategy !== 'lowest-latency';
    const eligibleTargets = model.getEligibleTargets(resolvedVersion.id, allowDegraded);

    const resolvedTargets: ResolvedTargetDto[] = eligibleTargets.map((target) => ({
      targetId: target.id,
      provider: target.provider,
      upstreamModelId: target.upstreamModelId,
      priority: target.priority,
      weight: target.weight,
      region: target.region,
      adapterOptions: target.adapterOptions,
      supportsStreaming: target.supportsStreaming,
      maxConcurrency: target.maxConcurrency,
    }));

    // -------------------------------------------------------------
    // STEP 6: Routing Policy, Limits & Pricing Attachment
    // -------------------------------------------------------------
    const response: ModelResolutionResponse = {
      canonicalModelId: model.id,
      version: resolvedVersion.version,
      displayName: model.displayName,
      description: model.description,
      family: model.family,
      modalities: resolvedVersion.modalities,
      capabilities: resolvedVersion.capabilities,
      limits: resolvedVersion.limits,
      pricing: resolvedVersion.pricing,
      status: resolvedVersion.status,
      effort: effectiveEffort,
      eligibleTargets: Object.freeze(resolvedTargets),
      routingPolicy: {
        strategy: model.routingPolicy.strategy,
        maxFallbackAttempts: model.routingPolicy.maxFallbackAttempts,
        requireHealthyTarget: model.routingPolicy.requireHealthyTarget,
        degradationBehavior: model.routingPolicy.degradationBehavior,
      },
      resolvedAt: new Date().toISOString(),
    };

    // -------------------------------------------------------------
    // STEP 7: Cache & Deliver Response
    // -------------------------------------------------------------
    await this.cache.setResolution(cacheKey, response, this.defaultCacheTtlSeconds);

    return response;
  }
}
