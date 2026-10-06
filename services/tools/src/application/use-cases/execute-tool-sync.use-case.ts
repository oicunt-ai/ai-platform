import { randomUUID } from 'node:crypto';
import type {
  NormalizedToolResultData,
  ToolArtifactRef,
  ToolAuditEvent,
  ToolExecutionRequest,
} from '../../domain/index.js';
import {
  assertArgumentsConform,
  assertOutputConforms,
  ConfirmationManager,
  ConfirmationRequiredError,
  ConflictError,
  DeadlineExceededError,
  MalformedToolResultError,
  PermissionDeniedError,
  RequestCancelledError,
  sanitizeToolArguments,
  ToolDisabledError,
  ToolExecutionFailedError,
  ToolNotFoundError,
  ToolPlatformError,
} from '../../domain/index.js';
import type { IdempotencyStorePort } from '../ports/idempotency-store.port.js';
import type { ObjectStoragePort } from '../ports/object-storage.port.js';
import type { ToolAuditRepositoryPort } from '../ports/tool-audit-repository.port.js';
import type { ToolExecutionContext, ToolExecutorPort } from '../ports/tool-executor.port.js';
import type { ToolRepositoryPort } from '../ports/tool-repository.port.js';

export interface ExecuteToolSyncCommand {
  readonly request: ToolExecutionRequest;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly actorRoles?: readonly string[] | undefined;
  readonly correlationId: string;
  readonly requestId: string;
  readonly deadlineAt?: string | undefined;
  readonly deadlineMs?: number | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly clientIp?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export class ExecuteToolSyncUseCase {
  constructor(
    private readonly repository: ToolRepositoryPort,
    private readonly executor: ToolExecutorPort,
    private readonly confirmationManager: ConfirmationManager,
    private readonly auditRepository: ToolAuditRepositoryPort,
    private readonly idempotencyStore: IdempotencyStorePort,
    private readonly objectStorage?: ObjectStoragePort | undefined,
  ) {}

  public async execute(command: ExecuteToolSyncCommand): Promise<NormalizedToolResultData> {
    const startTime = Date.now();
    const executionId = `exec_${randomUUID().replace(/-/g, '')}`;

    if (command.signal?.aborted) {
      throw new RequestCancelledError('Tool execution cancelled prior to dispatch');
    }

    // 1. Calculate monotonic deadline and timeout budget
    const remainingDeadlineMs = this.calculateRemainingDeadlineMs(command);
    if (remainingDeadlineMs !== undefined && remainingDeadlineMs <= 0) {
      throw new DeadlineExceededError('Monotonic deadline exceeded prior to tool execution');
    }

    // 2. Resolve Tool Definition
    const tool = await this.repository.findById(command.request.toolId, command.request.version);
    if (!tool) {
      throw new ToolNotFoundError(
        `Tool '${command.request.toolId}'${command.request.version ? ` version '${command.request.version}'` : ''} was not found`,
      );
    }

    if (tool.status === 'disabled') {
      throw new ToolDisabledError(`Tool '${tool.toolId}' is disabled globally`);
    }

    // 3. Tenant Entitlement & Actor RBAC
    const entitlement = await this.repository.getTenantEntitlement(command.tenantId, tool.toolId);
    if (entitlement && !entitlement.isEnabled) {
      throw new ToolDisabledError(
        `Tool '${tool.toolId}' is disabled for tenant '${command.tenantId}'`,
      );
    }

    if (entitlement && entitlement.allowedRoles && entitlement.allowedRoles.length > 0) {
      const actorRoles = new Set(command.actorRoles ?? []);
      const isAuthorized = entitlement.allowedRoles.some((role) => actorRoles.has(role));
      if (!isAuthorized) {
        throw new PermissionDeniedError(
          `Actor '${command.actorId}' lacks required roles to execute tool '${tool.toolId}'`,
        );
      }
    }

    // 4. Human-in-the-Loop Confirmation Gate
    if (tool.capabilities.requiresConfirmation) {
      if (!command.request.confirmationToken) {
        const challenge = this.confirmationManager.createChallenge({
          toolId: tool.toolId,
          version: tool.version,
          arguments: command.request.arguments,
          tenantId: command.tenantId,
          userId: command.userId,
          actorId: command.actorId,
        });
        throw new ConfirmationRequiredError(
          `Execution of '${tool.toolId}' requires human approval. Submit confirmation token.`,
          challenge,
        );
      }

      const isConfirmed = this.confirmationManager.verifyConfirmationToken({
        token: command.request.confirmationToken,
        toolId: tool.toolId,
        version: tool.version,
        arguments: command.request.arguments,
        tenantId: command.tenantId,
        userId: command.userId,
        actorId: command.actorId,
      });

      if (!isConfirmed) {
        const challenge = this.confirmationManager.createChallenge({
          toolId: tool.toolId,
          version: tool.version,
          arguments: command.request.arguments,
          tenantId: command.tenantId,
          userId: command.userId,
          actorId: command.actorId,
        });
        throw new ConfirmationRequiredError(
          `Invalid or expired confirmation token for '${tool.toolId}'`,
          challenge,
        );
      }
    }

    // 5. Pre-execution JSON Schema argument validation
    assertArgumentsConform(tool.parameters, command.request.arguments);

    // 6. Idempotency management
    const idempotencyLockKey = command.idempotencyKey
      ? `idemp:${command.tenantId}:${tool.toolId}:${command.idempotencyKey}`
      : undefined;

    if (idempotencyLockKey) {
      const cached = await this.idempotencyStore.getCachedResult(idempotencyLockKey);
      if (cached) {
        return cached;
      }

      const acquired = await this.idempotencyStore.acquireLock(
        idempotencyLockKey,
        tool.timeoutPolicy.maxTimeoutMs,
      );
      if (!acquired) {
        throw new ConflictError(
          `Concurrent execution with idempotency key '${command.idempotencyKey}' is already in progress`,
        );
      }
    }

    // 7. Calculate bounded timeout
    let effectiveTimeoutMs = tool.timeoutPolicy.defaultTimeoutMs;
    if (remainingDeadlineMs !== undefined) {
      effectiveTimeoutMs = Math.min(effectiveTimeoutMs, remainingDeadlineMs);
    }
    effectiveTimeoutMs = Math.min(effectiveTimeoutMs, tool.timeoutPolicy.maxTimeoutMs);

    // 8. Bind AbortController for execution timeout and cancellation
    const abortController = new AbortController();
    const forwardAbortHandler = () => abortController.abort();
    if (command.signal) {
      command.signal.addEventListener('abort', forwardAbortHandler, { once: true });
    }

    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, effectiveTimeoutMs);

    const executionContext: ToolExecutionContext = {
      executionId,
      correlationId: command.correlationId,
      callerId: command.actorId,
      tenantId: command.tenantId,
      userId: command.userId,
      actorId: command.actorId,
      timeoutMs: effectiveTimeoutMs,
      cancellationSignal: abortController.signal,
    };

    let executionOutput;
    try {
      executionOutput = await this.executor.execute(tool, command.request, executionContext);
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      if (command.signal) {
        command.signal.removeEventListener('abort', forwardAbortHandler);
      }

      if (idempotencyLockKey) {
        await this.idempotencyStore.releaseLock(idempotencyLockKey).catch(() => {});
      }

      if (abortController.signal.aborted) {
        if (command.signal?.aborted) {
          throw new RequestCancelledError('Tool execution was cancelled by caller');
        }
        throw new DeadlineExceededError(
          `Tool execution exceeded timeout of ${effectiveTimeoutMs}ms`,
          tool.capabilities.isReadOnly,
        );
      }

      if (err instanceof ToolPlatformError) {
        throw err;
      }

      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new ToolExecutionFailedError(
        `Tool execution failed: ${errorMessage}`,
        tool.capabilities.isReadOnly,
        err,
      );
    } finally {
      clearTimeout(timeoutHandle);
      if (command.signal) {
        command.signal.removeEventListener('abort', forwardAbortHandler);
      }
    }

    const durationMs = Date.now() - startTime;

    // 9. Post-execution Output Schema Validation
    if (executionOutput.status === 'success' && executionOutput.output !== undefined) {
      try {
        assertOutputConforms(tool.outputSchema, executionOutput.output);
      } catch (validationErr: unknown) {
        if (idempotencyLockKey) {
          await this.idempotencyStore.releaseLock(idempotencyLockKey).catch(() => {});
        }
        if (validationErr instanceof MalformedToolResultError) {
          throw validationErr;
        }
        throw new MalformedToolResultError(
          `Tool produced malformed output: ${validationErr instanceof Error ? validationErr.message : String(validationErr)}`,
        );
      }
    }

    // 10. Handle large payload offloading if necessary (> 10MB)
    const artifacts: ToolArtifactRef[] = [...(executionOutput.artifacts ?? [])];
    let normalizedOutput = executionOutput.output;

    if (
      this.objectStorage &&
      executionOutput.status === 'success' &&
      executionOutput.output !== undefined
    ) {
      const outputSerialized = JSON.stringify(executionOutput.output);
      const byteSize = Buffer.byteLength(outputSerialized, 'utf-8');
      if (byteSize > 10_485_760) {
        // Offload payload to object storage
        const artifactRef = await this.objectStorage.uploadArtifact({
          tenantId: command.tenantId,
          executionId,
          filename: `output_${executionId}.json`,
          content: outputSerialized,
          mimeType: 'application/json',
        });
        artifacts.push(artifactRef);
        normalizedOutput = {
          offloaded: true,
          artifactId: artifactRef.artifactId,
          uri: artifactRef.uri,
          sizeBytes: artifactRef.sizeBytes,
        };
      }
    }

    const resultData: NormalizedToolResultData = {
      callId: command.request.callId,
      toolId: tool.toolId,
      version: tool.version,
      status: executionOutput.status,
      output: normalizedOutput,
      textSummary: executionOutput.textSummary,
      error: executionOutput.error,
      artifacts: artifacts.length > 0 ? Object.freeze(artifacts) : undefined,
      execution: {
        executionId,
        durationMs,
        isReadOnly: tool.capabilities.isReadOnly,
        executedAt: new Date(startTime).toISOString(),
      },
    };

    // 11. Security Audit Logging (for mutating or sensitive tools)
    if (tool.capabilities.hasSideEffects || tool.capabilities.accessesSensitiveData) {
      const sanitizedArgs = sanitizeToolArguments(tool.parameters, command.request.arguments);
      const auditEvent: ToolAuditEvent = {
        auditId: `audit_${randomUUID().replace(/-/g, '')}`,
        executionId,
        timestamp: new Date().toISOString(),
        tenantId: command.tenantId,
        userId: command.userId,
        actorId: command.actorId,
        toolId: tool.toolId,
        version: tool.version,
        isReadOnly: tool.capabilities.isReadOnly,
        sanitizedArguments: sanitizedArgs,
        status: executionOutput.status,
        durationMs,
        confirmationTokenUsed: command.request.confirmationToken,
        clientIp: command.clientIp,
        correlationId: command.correlationId,
      };

      await this.auditRepository.record(auditEvent).catch(() => {});
    }

    // 12. Cache result & release lock for idempotency
    if (idempotencyLockKey) {
      if (resultData.status === 'success') {
        await this.idempotencyStore
          .cacheResult(idempotencyLockKey, resultData, 86400 * 1000)
          .catch(() => {});
      }
      await this.idempotencyStore.releaseLock(idempotencyLockKey).catch(() => {});
    }

    return resultData;
  }

  private calculateRemainingDeadlineMs(command: ExecuteToolSyncCommand): number | undefined {
    if (command.deadlineAt) {
      const deadlineEpoch = new Date(command.deadlineAt).getTime();
      if (!Number.isNaN(deadlineEpoch)) {
        return deadlineEpoch - Date.now();
      }
    }
    if (command.deadlineMs !== undefined) {
      // If deadlineMs is epoch timestamp (> 1_000_000_000_000)
      if (command.deadlineMs > 1_000_000_000_000) {
        return command.deadlineMs - Date.now();
      }
      return command.deadlineMs;
    }
    return undefined;
  }
}
