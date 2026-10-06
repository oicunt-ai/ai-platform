import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILT_IN_TOOLS,
  ConfirmationManager,
  ConfirmationRequiredError,
  InvalidToolArgumentsError,
  PermissionDeniedError,
  RequestCancelledError,
  ToolDisabledError,
  ToolNotFoundError,
  type ToolDefinition,
  type ToolId,
} from '../../src/domain/index.js';
import { ExecuteToolSyncUseCase } from '../../src/application/use-cases/execute-tool-sync.use-case.js';
import {
  InMemoryToolRepository,
  InMemoryToolAuditRepository,
} from '../../src/infrastructure/repositories/index.js';
import { InMemoryIdempotencyStore } from '../../src/infrastructure/idempotency/index.js';
import { InMemoryObjectStorage } from '../../src/infrastructure/storage/index.js';
import { ToolExecutorRouter } from '../../src/infrastructure/adapters/index.js';

describe('ExecuteToolSyncUseCase', () => {
  let repository: InMemoryToolRepository;
  let auditRepository: InMemoryToolAuditRepository;
  let idempotencyStore: InMemoryIdempotencyStore;
  let objectStorage: InMemoryObjectStorage;
  let confirmationManager: ConfirmationManager;
  let executor: ToolExecutorRouter;
  let useCase: ExecuteToolSyncUseCase;

  beforeEach(async () => {
    repository = new InMemoryToolRepository();
    auditRepository = new InMemoryToolAuditRepository();
    idempotencyStore = new InMemoryIdempotencyStore();
    objectStorage = new InMemoryObjectStorage();
    confirmationManager = new ConfirmationManager();
    executor = new ToolExecutorRouter();

    // Seed built-in tools
    for (const tool of BUILT_IN_TOOLS) {
      await repository.saveTool(tool);
    }

    useCase = new ExecuteToolSyncUseCase(
      repository,
      executor,
      confirmationManager,
      auditRepository,
      idempotencyStore,
      objectStorage,
    );
  });

  it('synchronously executes built-in math calculation and returns normalized envelope', async () => {
    const result = await useCase.execute({
      request: {
        callId: 'call_123',
        toolId: 'oicunt.tool.computation.evaluate',
        arguments: { expression: '(15 + 5) * 3' },
      },
      tenantId: 'tenant_test',
      userId: 'user_1',
      actorId: 'actor_1',
      correlationId: 'corr_1',
      requestId: 'req_1',
    });

    expect(result.status).toBe('success');
    expect(result.callId).toBe('call_123');
    expect(result.toolId).toBe('oicunt.tool.computation.evaluate');
    expect((result.output as { result: number }).result).toBe(60);
    expect(result.textSummary).toContain('60');
    expect(result.execution.isReadOnly).toBe(true);
    expect(result.execution.executionId).toBeDefined();
  });

  it('fails with INVALID_TOOL_ARGUMENTS if required argument is missing', async () => {
    await expect(
      useCase.execute({
        request: {
          callId: 'call_2',
          toolId: 'oicunt.tool.computation.evaluate',
          arguments: {}, // missing 'expression'
        },
        tenantId: 'tenant_test',
        userId: 'user_1',
        actorId: 'actor_1',
        correlationId: 'corr_1',
        requestId: 'req_1',
      }),
    ).rejects.toThrow(InvalidToolArgumentsError);
  });

  it('fails with TOOL_NOT_FOUND when tool does not exist', async () => {
    await expect(
      useCase.execute({
        request: {
          callId: 'call_3',
          toolId: 'oicunt.tool.unknown.tool' as ToolId,
          arguments: {},
        },
        tenantId: 'tenant_test',
        userId: 'user_1',
        actorId: 'actor_1',
        correlationId: 'corr_1',
        requestId: 'req_1',
      }),
    ).rejects.toThrow(ToolNotFoundError);
  });

  it('enforces tenant entitlement and disables execution when tool disabled for tenant', async () => {
    await repository.setTenantEntitlement({
      tenantId: 'tenant_restricted',
      toolId: 'oicunt.tool.computation.evaluate',
      isEnabled: false,
      allowedRoles: [],
    });

    await expect(
      useCase.execute({
        request: {
          callId: 'call_4',
          toolId: 'oicunt.tool.computation.evaluate',
          arguments: { expression: '1 + 1' },
        },
        tenantId: 'tenant_restricted',
        userId: 'user_1',
        actorId: 'actor_1',
        correlationId: 'corr_1',
        requestId: 'req_1',
      }),
    ).rejects.toThrow(ToolDisabledError);
  });

  it('enforces actor RBAC role restrictions', async () => {
    await repository.setTenantEntitlement({
      tenantId: 'tenant_rbac',
      toolId: 'oicunt.tool.computation.evaluate',
      isEnabled: true,
      allowedRoles: ['admin', 'operator'],
    });

    // Fails for actor with 'analyst' role
    await expect(
      useCase.execute({
        request: {
          callId: 'call_5',
          toolId: 'oicunt.tool.computation.evaluate',
          arguments: { expression: '1 + 1' },
        },
        tenantId: 'tenant_rbac',
        userId: 'user_1',
        actorId: 'actor_1',
        actorRoles: ['analyst'],
        correlationId: 'corr_1',
        requestId: 'req_1',
      }),
    ).rejects.toThrow(PermissionDeniedError);

    // Succeeds for actor with 'admin' role
    const successResult = await useCase.execute({
      request: {
        callId: 'call_6',
        toolId: 'oicunt.tool.computation.evaluate',
        arguments: { expression: '1 + 1' },
      },
      tenantId: 'tenant_rbac',
      userId: 'user_1',
      actorId: 'actor_1',
      actorRoles: ['admin'],
      correlationId: 'corr_1',
      requestId: 'req_1',
    });

    expect(successResult.status).toBe('success');
  });

  it('requires human approval challenge for tools declaring requiresConfirmation: true', async () => {
    const sensitiveTool: ToolDefinition = {
      toolId: 'oicunt.tool.communication.send_notification',
      displayName: 'Send Notification',
      description: 'Sends external notification',
      version: '1.0.0',
      category: 'communication',
      source: 'internal',
      capabilities: {
        isReadOnly: false,
        hasSideEffects: true,
        requiresConfirmation: true,
        networkEgress: false,
        accessesSensitiveData: true,
      },
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['channel', 'message'],
      },
      timeoutPolicy: { defaultTimeoutMs: 5000, maxTimeoutMs: 15000 },
      status: 'active',
      tags: ['communication'],
    };

    await repository.saveTool(sensitiveTool);

    // Initial invocation without token throws ConfirmationRequiredError with challenge
    let challengeToken: string | undefined;
    try {
      await useCase.execute({
        request: {
          callId: 'call_conf_1',
          toolId: sensitiveTool.toolId,
          arguments: { channel: 'slack', message: 'Deployment triggered' },
        },
        tenantId: 'tenant_conf',
        userId: 'user_admin',
        actorId: 'actor_admin',
        correlationId: 'corr_1',
        requestId: 'req_1',
      });
      expect.fail('Should have thrown ConfirmationRequiredError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ConfirmationRequiredError);
      const confErr = err as ConfirmationRequiredError;
      expect(confErr.challenge.challengeToken).toBeDefined();
      expect(confErr.challenge.argumentsHash).toBeDefined();
      challengeToken = confErr.challenge.challengeToken;
    }

    // Sign confirmation token
    const token = confirmationManager.issueConfirmationToken({
      challengeToken: challengeToken!,
      tenantId: 'tenant_conf',
      userId: 'user_admin',
      actorId: 'actor_admin',
      toolId: sensitiveTool.toolId,
      version: sensitiveTool.version,
      argumentsHash: confirmationManager.createChallenge({
        toolId: sensitiveTool.toolId,
        version: sensitiveTool.version,
        arguments: { channel: 'slack', message: 'Deployment triggered' },
        tenantId: 'tenant_conf',
        userId: 'user_admin',
        actorId: 'actor_admin',
      }).argumentsHash,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });

    // Provide custom internal mock handler for communication tool
    executor.registerCustomAdapter(sensitiveTool.toolId, {
      execute: async (_def, req, ctx) => ({
        executionId: ctx.executionId,
        callId: req.callId,
        status: 'success',
        output: { delivered: true },
        durationMs: 5,
      }),
    });

    // Second execution with valid confirmationToken succeeds
    const confirmedResult = await useCase.execute({
      request: {
        callId: 'call_conf_2',
        toolId: sensitiveTool.toolId,
        arguments: { channel: 'slack', message: 'Deployment triggered' },
        confirmationToken: token,
      },
      tenantId: 'tenant_conf',
      userId: 'user_admin',
      actorId: 'actor_admin',
      correlationId: 'corr_1',
      requestId: 'req_1',
    });

    expect(confirmedResult.status).toBe('success');

    // Verify audit log was written for this side-effecting tool
    const auditLogs = await auditRepository.listByTenant('tenant_conf');
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]!.toolId).toBe(sensitiveTool.toolId);
    expect(auditLogs[0]!.confirmationTokenUsed).toBe(token);
  });

  it('caches and returns identical result for identical idempotency key', async () => {
    let callCount = 0;
    executor.registerCustomAdapter('oicunt.tool.system.echo', {
      execute: async (_def, req, ctx) => {
        callCount++;
        return {
          executionId: ctx.executionId,
          callId: req.callId,
          status: 'success',
          output: { count: callCount },
          durationMs: 2,
        };
      },
    });

    const res1 = await useCase.execute({
      request: {
        callId: 'call_idemp_1',
        toolId: 'oicunt.tool.system.echo',
        arguments: { message: 'hi' },
      },
      tenantId: 'tenant_idemp',
      userId: 'user_1',
      actorId: 'actor_1',
      idempotencyKey: 'idemp-key-unique-123',
      correlationId: 'corr_1',
      requestId: 'req_1',
    });

    expect((res1.output as { count: number }).count).toBe(1);

    // Second execution with same idempotency key
    const res2 = await useCase.execute({
      request: {
        callId: 'call_idemp_2',
        toolId: 'oicunt.tool.system.echo',
        arguments: { message: 'hi' },
      },
      tenantId: 'tenant_idemp',
      userId: 'user_1',
      actorId: 'actor_1',
      idempotencyKey: 'idemp-key-unique-123',
      correlationId: 'corr_1',
      requestId: 'req_2',
    });

    expect((res2.output as { count: number }).count).toBe(1);
    expect(callCount).toBe(1); // not executed second time
  });

  it('aborts promptly when cancellation signal is triggered', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      useCase.execute({
        request: {
          callId: 'call_cancel',
          toolId: 'oicunt.tool.computation.evaluate',
          arguments: { expression: '1 + 1' },
        },
        tenantId: 'tenant_test',
        userId: 'user_1',
        actorId: 'actor_1',
        correlationId: 'corr_1',
        requestId: 'req_1',
        signal: controller.signal,
      }),
    ).rejects.toThrow(RequestCancelledError);
  });
});
