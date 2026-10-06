import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, InvalidRequestError } from '../../../src/domain/index.js';
import {
  AppendMessagesUseCase,
  CreateConversationUseCase,
  PurgeDataUseCase,
} from '../../../src/application/use-cases/index.js';
import { InMemoryConversationRepository } from '../../../src/infrastructure/repositories/in-memory-conversation.repository.js';

describe('PurgeDataUseCase (GDPR / Hard Erasure)', () => {
  let repository: InMemoryConversationRepository;
  let createUseCase: CreateConversationUseCase;
  let appendUseCase: AppendMessagesUseCase;
  let purgeUseCase: PurgeDataUseCase;

  beforeEach(() => {
    repository = new InMemoryConversationRepository();
    createUseCase = new CreateConversationUseCase(repository);
    appendUseCase = new AppendMessagesUseCase(repository);
    purgeUseCase = new PurgeDataUseCase(repository);
  });

  it('rejects non-admin services from calling purge', async () => {
    await expect(
      purgeUseCase.execute(
        { reason: 'GDPR Article 17 request' },
        {
          tenantId: 'tenant-1',
          callerServiceName: 'ai-orchestrator',
        },
      ),
    ).rejects.toThrow(ForbiddenError);

    await expect(
      purgeUseCase.execute(
        { reason: 'GDPR Article 17 request' },
        {
          tenantId: 'tenant-1',
          callerServiceName: 'billy-api',
        },
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('validates tenant and reason', async () => {
    await expect(
      purgeUseCase.execute(
        { reason: '' },
        {
          tenantId: 'tenant-1',
          callerServiceName: 'ai-platform-admin',
        },
      ),
    ).rejects.toThrow(InvalidRequestError);

    await expect(
      purgeUseCase.execute(
        { reason: 'Test reason' },
        {
          tenantId: '',
          callerServiceName: 'ai-platform-admin',
        },
      ),
    ).rejects.toThrow(InvalidRequestError);
  });

  it('purges only target user data within a tenant when userId is specified', async () => {
    // User 1 conv
    const conv1 = await createUseCase.execute(
      { title: 'User 1 Conv' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );
    await appendUseCase.execute(
      conv1.id,
      {
        turnId: 't-1',
        messages: [{ role: 'user', content: 'hello from user 1' }],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // User 2 conv
    const conv2 = await createUseCase.execute(
      { title: 'User 2 Conv' },
      { tenantId: 'tenant-1', userId: 'user-2' },
    );
    await appendUseCase.execute(
      conv2.id,
      {
        turnId: 't-2',
        messages: [{ role: 'user', content: 'hello from user 2' }],
      },
      { tenantId: 'tenant-1', userId: 'user-2' },
    );

    // Purge only user 1
    const res = await purgeUseCase.execute(
      { userId: 'user-1', reason: 'User account deleted' },
      { tenantId: 'tenant-1', callerServiceName: 'ai-platform-admin' },
    );

    expect(res.tenantId).toBe('tenant-1');
    expect(res.userId).toBe('user-1');
    expect(res.purgedConversations).toBe(1);
    expect(res.purgedMessages).toBe(1);

    // User 1 conv is gone
    const conv1After = await repository.getConversationById('tenant-1', conv1.id);
    expect(conv1After).toBeNull();

    // User 2 conv remains intact
    const conv2After = await repository.getConversationById('tenant-1', conv2.id);
    expect(conv2After).not.toBeNull();
  });

  it('purges all data for a tenant when userId is omitted, leaving other tenants unaffected', async () => {
    // Tenant 1
    const t1c1 = await createUseCase.execute(
      { title: 'T1 Conv' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );
    await appendUseCase.execute(
      t1c1.id,
      { turnId: 't-1', messages: [{ role: 'user', content: 'msg 1' }] },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Tenant 2
    const t2c1 = await createUseCase.execute(
      { title: 'T2 Conv' },
      { tenantId: 'tenant-2', userId: 'user-1' },
    );
    await appendUseCase.execute(
      t2c1.id,
      { turnId: 't-2', messages: [{ role: 'user', content: 'msg 2' }] },
      { tenantId: 'tenant-2', userId: 'user-1' },
    );

    // Purge tenant-1 entirely
    const res = await purgeUseCase.execute(
      { reason: 'Tenant subscription cancelled' },
      { tenantId: 'tenant-1', callerServiceName: 'ai-platform-admin' },
    );

    expect(res.purgedConversations).toBe(1);
    expect(res.purgedMessages).toBe(1);

    expect(await repository.getConversationById('tenant-1', t1c1.id)).toBeNull();
    expect(await repository.getConversationById('tenant-2', t2c1.id)).not.toBeNull();
  });
});
