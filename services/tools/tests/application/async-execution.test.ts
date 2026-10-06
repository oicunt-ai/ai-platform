import { beforeEach, describe, expect, it } from 'vitest';
import { BUILT_IN_TOOLS, ConfirmationManager } from '../../src/domain/index.js';
import {
  CancelExecutionUseCase,
  ExecuteToolAsyncUseCase,
  ExecuteToolSyncUseCase,
  GetExecutionStatusUseCase,
} from '../../src/application/use-cases/index.js';
import {
  InMemoryToolRepository,
  InMemoryToolAuditRepository,
} from '../../src/infrastructure/repositories/index.js';
import { InMemoryIdempotencyStore } from '../../src/infrastructure/idempotency/index.js';
import { InMemoryObjectStorage } from '../../src/infrastructure/storage/index.js';
import { ToolExecutorRouter } from '../../src/infrastructure/adapters/index.js';

describe('Async Execution Use Cases', () => {
  let repository: InMemoryToolRepository;
  let auditRepository: InMemoryToolAuditRepository;
  let idempotencyStore: InMemoryIdempotencyStore;
  let objectStorage: InMemoryObjectStorage;
  let confirmationManager: ConfirmationManager;
  let executor: ToolExecutorRouter;
  let syncUseCase: ExecuteToolSyncUseCase;
  let asyncUseCase: ExecuteToolAsyncUseCase;
  let getStatusUseCase: GetExecutionStatusUseCase;
  let cancelUseCase: CancelExecutionUseCase;

  beforeEach(async () => {
    repository = new InMemoryToolRepository();
    auditRepository = new InMemoryToolAuditRepository();
    idempotencyStore = new InMemoryIdempotencyStore();
    objectStorage = new InMemoryObjectStorage();
    confirmationManager = new ConfirmationManager();
    executor = new ToolExecutorRouter();

    for (const tool of BUILT_IN_TOOLS) {
      await repository.saveTool(tool);
    }

    syncUseCase = new ExecuteToolSyncUseCase(
      repository,
      executor,
      confirmationManager,
      auditRepository,
      idempotencyStore,
      objectStorage,
    );
    asyncUseCase = new ExecuteToolAsyncUseCase(repository, syncUseCase);
    getStatusUseCase = new GetExecutionStatusUseCase(repository);
    cancelUseCase = new CancelExecutionUseCase(repository);
  });

  it('enqueues an async execution job, polls status, and retrieves completion', async () => {
    const accepted = await asyncUseCase.execute({
      request: {
        callId: 'call_async_1',
        toolId: 'oicunt.tool.computation.evaluate',
        arguments: { expression: '100 / 4' },
      },
      tenantId: 'tenant_async',
      userId: 'user_async',
      actorId: 'actor_async',
      correlationId: 'corr_async',
      requestId: 'req_async',
    });

    expect(accepted.executionId).toBeDefined();
    expect(accepted.status).toBe('pending');

    // Wait a brief tick for queueMicrotask to execute
    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = await getStatusUseCase.execute({
      executionId: accepted.executionId,
      tenantId: 'tenant_async',
    });

    expect(status.status).toBe('completed');
    expect(status.result).toBeDefined();
    expect((status.result?.output as { result: number }).result).toBe(25);
  });

  it('cancels an in-flight async execution', async () => {
    const accepted = await asyncUseCase.execute({
      request: {
        callId: 'call_async_cancel',
        toolId: 'oicunt.tool.computation.evaluate',
        arguments: { expression: '1 + 1' },
      },
      tenantId: 'tenant_async',
      userId: 'user_async',
      actorId: 'actor_async',
      correlationId: 'corr_async',
      requestId: 'req_async',
    });

    const cancelled = await cancelUseCase.execute({
      executionId: accepted.executionId,
      tenantId: 'tenant_async',
    });

    expect(cancelled.status).toBe('cancelled');
  });
});
