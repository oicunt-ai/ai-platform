import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
  UserMismatchError,
} from '../../../src/domain/index.js';
import {
  CreateConversationUseCase,
  DeleteConversationUseCase,
  GetConversationUseCase,
  ListConversationsUseCase,
  UpdateConversationUseCase,
} from '../../../src/application/use-cases/index.js';
import { InMemoryConversationRepository } from '../../../src/infrastructure/repositories/in-memory-conversation.repository.js';

describe('Conversation Lifecycle Use Cases', () => {
  let repository: InMemoryConversationRepository;
  let createUseCase: CreateConversationUseCase;
  let getUseCase: GetConversationUseCase;
  let listUseCase: ListConversationsUseCase;
  let updateUseCase: UpdateConversationUseCase;
  let deleteUseCase: DeleteConversationUseCase;

  beforeEach(() => {
    repository = new InMemoryConversationRepository();
    createUseCase = new CreateConversationUseCase(repository);
    getUseCase = new GetConversationUseCase(repository);
    listUseCase = new ListConversationsUseCase(repository);
    updateUseCase = new UpdateConversationUseCase(repository);
    deleteUseCase = new DeleteConversationUseCase(repository);
  });

  it('creates and retrieves a conversation with initial state', async () => {
    const conv = await createUseCase.execute(
      { title: 'Project Discussion', metadata: { source: 'test' } },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(conv.id).toMatch(/^conv_/);
    expect(conv.tenantId).toBe('tenant-1');
    expect(conv.userId).toBe('user-1');
    expect(conv.title).toBe('Project Discussion');
    expect(conv.status).toBe('active');
    expect(conv.messageCount).toBe(0);
    expect(conv.totalTokensEstimate).toBe(0);

    const fetched = await getUseCase.execute(conv.id, { tenantId: 'tenant-1' });
    expect(fetched.id).toBe(conv.id);
  });

  it('enforces tenant isolation and throws for unknown conversation', async () => {
    const conv = await createUseCase.execute(
      { title: 'Secret' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    await expect(getUseCase.execute(conv.id, { tenantId: 'tenant-2' })).rejects.toThrow(
      ConversationNotFoundError,
    );
  });

  it('validates mandatory tenant and user ID on creation', async () => {
    await expect(createUseCase.execute({}, { tenantId: '', userId: 'u1' })).rejects.toThrow(
      InvalidRequestError,
    );

    await expect(createUseCase.execute({}, { tenantId: 't1', userId: '' })).rejects.toThrow(
      InvalidRequestError,
    );
  });

  it('enforces user ownership independently of the caller service name', async () => {
    const conv = await createUseCase.execute(
      { title: 'User Owned' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Same user succeeds
    const ok = await getUseCase.execute(conv.id, {
      tenantId: 'tenant-1',
      userId: 'user-1',
      callerServiceName: 'ai-orchestrator',
    });
    expect(ok.id).toBe(conv.id);

    // Mismatched user fails
    await expect(
      getUseCase.execute(conv.id, {
        tenantId: 'tenant-1',
        userId: 'user-2',
        callerServiceName: 'ai-orchestrator',
      }),
    ).rejects.toThrow(UserMismatchError);
  });

  it('lists conversations with status and user filtering', async () => {
    await createUseCase.execute({ title: 'A' }, { tenantId: 't1', userId: 'u1' });
    await createUseCase.execute({ title: 'B' }, { tenantId: 't1', userId: 'u1' });
    await createUseCase.execute({ title: 'C' }, { tenantId: 't1', userId: 'u2' });
    await createUseCase.execute({ title: 'D' }, { tenantId: 't2', userId: 'u1' });

    const t1All = await listUseCase.execute({}, { tenantId: 't1' });
    expect(t1All.total).toBe(3);

    const t1User1 = await listUseCase.execute({ userId: 'u1' }, { tenantId: 't1' });
    expect(t1User1.total).toBe(2);
  });

  it('updates conversation title, metadata, and status', async () => {
    const conv = await createUseCase.execute(
      { title: 'Old Title' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    const updated = await updateUseCase.execute(
      conv.id,
      { title: 'New Title', status: 'archived', metadata: { archivedBy: 'test' } },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(updated.title).toBe('New Title');
    expect(updated.status).toBe('archived');
    expect(updated.metadata).toEqual({ archivedBy: 'test' });
  });

  it('handles soft-deletion and hard-purging according to contract', async () => {
    const conv = await createUseCase.execute(
      { title: 'To Delete' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Soft delete
    const softRes = await deleteUseCase.execute(conv.id, {
      tenantId: 'tenant-1',
      hard: false,
    });
    expect(softRes.hard).toBe(false);

    // Get without allowDeleted throws ConversationDeletedError
    await expect(getUseCase.execute(conv.id, { tenantId: 'tenant-1' })).rejects.toThrow(
      ConversationDeletedError,
    );

    // List by default excludes soft-deleted
    const listRes = await listUseCase.execute({}, { tenantId: 'tenant-1' });
    expect(listRes.conversations.some((c) => c.id === conv.id)).toBe(false);

    // Hard purge
    const hardRes = await deleteUseCase.execute(conv.id, {
      tenantId: 'tenant-1',
      hard: true,
    });
    expect(hardRes.hard).toBe(true);

    // Get now throws ConversationNotFoundError
    await expect(
      getUseCase.execute(conv.id, { tenantId: 'tenant-1', allowDeleted: true }),
    ).rejects.toThrow(ConversationNotFoundError);
  });
});
