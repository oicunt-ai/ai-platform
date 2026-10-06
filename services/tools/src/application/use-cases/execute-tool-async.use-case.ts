import { randomUUID } from 'node:crypto';
import type { AsyncExecutionJob, ToolExecutionRequest } from '../../domain/index.js';
import {
  PermissionDeniedError,
  ToolDisabledError,
  ToolNotFoundError,
  ToolPlatformError,
} from '../../domain/index.js';
import type { ToolRepositoryPort } from '../ports/tool-repository.port.js';
import type { ExecuteToolSyncUseCase } from './execute-tool-sync.use-case.js';

export interface ExecuteToolAsyncCommand {
  readonly request: ToolExecutionRequest;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly actorRoles?: readonly string[] | undefined;
  readonly correlationId: string;
  readonly requestId: string;
  readonly clientIp?: string | undefined;
}

export interface AsyncExecutionAcceptedResult {
  readonly executionId: string;
  readonly status: 'pending';
}

export class ExecuteToolAsyncUseCase {
  constructor(
    private readonly repository: ToolRepositoryPort,
    private readonly executeSyncUseCase: ExecuteToolSyncUseCase,
  ) {}

  public async execute(command: ExecuteToolAsyncCommand): Promise<AsyncExecutionAcceptedResult> {
    const tool = await this.repository.findById(command.request.toolId, command.request.version);
    if (!tool) {
      throw new ToolNotFoundError(
        `Tool '${command.request.toolId}'${command.request.version ? ` version '${command.request.version}'` : ''} was not found`,
      );
    }

    if (tool.status === 'disabled') {
      throw new ToolDisabledError(`Tool '${tool.toolId}' is disabled globally`);
    }

    // Tenant entitlement & RBAC check
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

    const executionId = `exec_${randomUUID().replace(/-/g, '')}`;

    const job: AsyncExecutionJob = {
      executionId,
      callId: command.request.callId,
      tenantId: command.tenantId,
      userId: command.userId,
      actorId: command.actorId,
      toolId: tool.toolId,
      version: tool.version,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    await this.repository.createAsyncExecution(job);

    // Run execution asynchronously in background
    queueMicrotask(() => {
      void this.runJobInBackground(command, executionId);
    });

    return {
      executionId,
      status: 'pending',
    };
  }

  private async runJobInBackground(
    command: ExecuteToolAsyncCommand,
    executionId: string,
  ): Promise<void> {
    try {
      await this.repository.updateAsyncExecution(executionId, { status: 'running' });

      const result = await this.executeSyncUseCase.execute({
        request: command.request,
        tenantId: command.tenantId,
        userId: command.userId,
        actorId: command.actorId,
        actorRoles: command.actorRoles,
        correlationId: command.correlationId,
        requestId: command.requestId,
        clientIp: command.clientIp,
      });

      await this.repository.updateAsyncExecution(executionId, {
        status: 'completed',
        result,
        completedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const isPlatformError = err instanceof ToolPlatformError;
      const code = isPlatformError ? err.code : 'TOOL_EXECUTION_FAILED';
      const message = err instanceof Error ? err.message : String(err);
      const retryable = isPlatformError ? err.retryable : false;

      await this.repository
        .updateAsyncExecution(executionId, {
          status: 'failed',
          error: {
            code,
            message,
            retryable,
            details: isPlatformError ? err.details : undefined,
          },
          completedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }
  }
}
