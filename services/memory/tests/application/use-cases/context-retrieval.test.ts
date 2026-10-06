import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
  UserMismatchError,
} from '../../../src/domain/index.js';
import {
  AppendMessagesUseCase,
  CreateConversationUseCase,
  DeleteConversationUseCase,
  GetContextUseCase,
} from '../../../src/application/use-cases/index.js';
import { InMemoryConversationRepository } from '../../../src/infrastructure/repositories/in-memory-conversation.repository.js';

describe('GetContextUseCase (Bounded Context Retrieval)', () => {
  let repository: InMemoryConversationRepository;
  let createUseCase: CreateConversationUseCase;
  let appendUseCase: AppendMessagesUseCase;
  let deleteUseCase: DeleteConversationUseCase;
  let getContextUseCase: GetContextUseCase;

  beforeEach(() => {
    repository = new InMemoryConversationRepository();
    createUseCase = new CreateConversationUseCase(repository);
    appendUseCase = new AppendMessagesUseCase(repository);
    deleteUseCase = new DeleteConversationUseCase(repository);
    getContextUseCase = new GetContextUseCase(repository);
  });

  it('bounds retrieved messages by maxMessages and preserves chronological ASC order', async () => {
    const conv = await createUseCase.execute(
      { title: 'Test Context' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Append 6 messages (seq 1 to 6)
    await appendUseCase.execute(
      conv.id,
      {
        turnId: 'turn-1',
        messages: [
          { role: 'user', content: 'Message 1' },
          { role: 'assistant', content: 'Message 2' },
          { role: 'user', content: 'Message 3' },
          { role: 'assistant', content: 'Message 4' },
          { role: 'user', content: 'Message 5' },
          { role: 'assistant', content: 'Message 6' },
        ],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Retrieve with maxMessages = 3
    const context = await getContextUseCase.execute(
      conv.id,
      { maxMessages: 3 },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(context.messages.length).toBe(3);
    expect(context.returnedMessages).toBe(3);
    expect(context.totalStoredMessages).toBe(6);
    expect(context.hasMore).toBe(true);

    // Messages must be chronologically ascending: 4, 5, 6
    expect(context.messages[0]!.content).toBe('Message 4');
    expect(context.messages[0]!.metadata?.sequenceNumber).toBe(4);
    expect(context.messages[1]!.content).toBe('Message 5');
    expect(context.messages[1]!.metadata?.sequenceNumber).toBe(5);
    expect(context.messages[2]!.content).toBe('Message 6');
    expect(context.messages[2]!.metadata?.sequenceNumber).toBe(6);

    expect(context.earliestSequenceNumber).toBe(4);
    expect(context.latestSequenceNumber).toBe(6);
  });

  it('bounds retrieved messages by maxTokens and accumulates from most recent', async () => {
    const conv = await createUseCase.execute(
      { title: 'Token Budget Test' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Append 4 messages with varying lengths
    // Message 1 & 2: long
    // Message 3 & 4: short
    await appendUseCase.execute(
      conv.id,
      {
        turnId: 'turn-1',
        messages: [
          { role: 'user', content: 'A'.repeat(400) }, // ~104 tokens
          { role: 'assistant', content: 'B'.repeat(400) }, // ~104 tokens
          { role: 'user', content: 'Short question' }, // ~8 tokens
          { role: 'assistant', content: 'Short answer' }, // ~7 tokens
        ],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Request with maxTokens: 40 (only the two short messages will fit)
    const context = await getContextUseCase.execute(
      conv.id,
      { maxTokens: 40 },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(context.messages.length).toBe(2);
    expect(context.messages[0]!.content).toBe('Short question');
    expect(context.messages[1]!.content).toBe('Short answer');
    expect(context.hasMore).toBe(true);
    expect(context.estimatedTokens).toBeLessThanOrEqual(40);
  });

  it('respects beforeSequenceNumber for checkpoint retrieval', async () => {
    const conv = await createUseCase.execute(
      { title: 'Checkpoint Test' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    await appendUseCase.execute(
      conv.id,
      {
        turnId: 'turn-1',
        messages: [
          { role: 'user', content: 'Step 1' },
          { role: 'assistant', content: 'Step 2' },
          { role: 'user', content: 'Step 3' },
          { role: 'assistant', content: 'Step 4' },
        ],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Retrieve before sequence 3 (should return sequence 1 and 2)
    const context = await getContextUseCase.execute(
      conv.id,
      { beforeSequenceNumber: 3 },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(context.messages.length).toBe(2);
    expect(context.messages[0]!.metadata?.sequenceNumber).toBe(1);
    expect(context.messages[1]!.metadata?.sequenceNumber).toBe(2);
    expect(context.latestSequenceNumber).toBe(2);
  });

  it('attaches active summary if older compacted messages exist', async () => {
    const conv = await createUseCase.execute(
      { title: 'Summary Test' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    await appendUseCase.execute(
      conv.id,
      {
        turnId: 'turn-1',
        messages: [
          { role: 'user', content: 'Early 1' },
          { role: 'assistant', content: 'Early 2' },
          { role: 'user', content: 'Recent 3' },
          { role: 'assistant', content: 'Recent 4' },
        ],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Seed a summary for sequences 1 to 2
    await repository.saveSummary({
      id: 'sum-1',
      tenantId: 'tenant-1',
      conversationId: conv.id,
      sequenceStart: 1,
      sequenceEnd: 2,
      summaryText: 'User and assistant discussed early points.',
      tokenEstimate: 12,
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    const contextWithSummary = await getContextUseCase.execute(
      conv.id,
      { includeSummary: true },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(contextWithSummary.summary).toBe('User and assistant discussed early points.');
    // Only messages after sequence 2 are returned: 3 and 4
    expect(contextWithSummary.messages.length).toBe(2);
    expect(contextWithSummary.messages[0]!.metadata?.sequenceNumber).toBe(3);
    expect(contextWithSummary.messages[1]!.metadata?.sequenceNumber).toBe(4);
    expect(contextWithSummary.hasMore).toBe(true);

    // With includeSummary: false
    const contextWithoutSummary = await getContextUseCase.execute(
      conv.id,
      { includeSummary: false },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(contextWithoutSummary.summary).toBeNull();
    // All 4 messages returned
    expect(contextWithoutSummary.messages.length).toBe(4);
  });

  it('rejects soft-deleted conversations with ConversationDeletedError', async () => {
    const conv = await createUseCase.execute(
      { title: 'Soft Deleted' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    await deleteUseCase.execute(conv.id, { tenantId: 'tenant-1', hard: false });

    await expect(
      getContextUseCase.execute(conv.id, {}, { tenantId: 'tenant-1', userId: 'user-1' }),
    ).rejects.toThrow(ConversationDeletedError);
  });

  it('enforces billy-api user ownership check', async () => {
    const conv = await createUseCase.execute(
      { title: 'Owned Conv' },
      { tenantId: 'tenant-1', userId: 'user-owner' },
    );

    await expect(
      getContextUseCase.execute(
        conv.id,
        {},
        {
          tenantId: 'tenant-1',
          userId: 'user-other',
          callerServiceName: 'billy-api',
        },
      ),
    ).rejects.toThrow(UserMismatchError);

    // Internal service (e.g. ai-orchestrator) is allowed to read without user mismatch check
    const internalContext = await getContextUseCase.execute(
      conv.id,
      {},
      {
        tenantId: 'tenant-1',
        callerServiceName: 'ai-orchestrator',
      },
    );
    expect(internalContext.conversationId).toBe(conv.id);
  });

  it('validates tenant and conversation existence', async () => {
    await expect(
      getContextUseCase.execute('non-existent', {}, { tenantId: 'tenant-1' }),
    ).rejects.toThrow(ConversationNotFoundError);

    await expect(getContextUseCase.execute('', {}, { tenantId: 'tenant-1' })).rejects.toThrow(
      InvalidRequestError,
    );

    await expect(getContextUseCase.execute('c-1', {}, { tenantId: '' })).rejects.toThrow(
      InvalidRequestError,
    );
  });
});
