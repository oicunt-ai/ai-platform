import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConversationDeletedError,
  ConversationNotFoundError,
  InvalidRequestError,
} from '../../../src/domain/index.js';
import {
  AppendMessagesUseCase,
  CreateConversationUseCase,
  DeleteConversationUseCase,
  ListMessagesUseCase,
} from '../../../src/application/use-cases/index.js';
import { InMemoryConversationRepository } from '../../../src/infrastructure/repositories/in-memory-conversation.repository.js';

describe('Message Sequencing & Appending Use Cases', () => {
  let repository: InMemoryConversationRepository;
  let createUseCase: CreateConversationUseCase;
  let appendUseCase: AppendMessagesUseCase;
  let listMessagesUseCase: ListMessagesUseCase;
  let deleteUseCase: DeleteConversationUseCase;

  beforeEach(() => {
    repository = new InMemoryConversationRepository();
    createUseCase = new CreateConversationUseCase(repository);
    appendUseCase = new AppendMessagesUseCase(repository);
    listMessagesUseCase = new ListMessagesUseCase(repository);
    deleteUseCase = new DeleteConversationUseCase(repository);
  });

  it('assigns strictly increasing, unique sequence numbers across multiple turns', async () => {
    const conv = await createUseCase.execute(
      { title: 'Chat' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    // Turn 1: user and assistant
    const turn1 = await appendUseCase.execute(
      conv.id,
      {
        turnId: 'turn-1',
        messages: [
          { role: 'user', content: 'What is 2+2?' },
          { role: 'assistant', content: '2+2 is 4.' },
        ],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(turn1.appendedCount).toBe(2);
    expect(turn1.totalConversationMessages).toBe(2);
    expect(turn1.messages[0]!.sequenceNumber).toBe(1);
    expect(turn1.messages[1]!.sequenceNumber).toBe(2);

    // Turn 2: tool loop (user, assistant tool_call, tool result, final assistant)
    const turn2 = await appendUseCase.execute(
      conv.id,
      {
        turnId: 'turn-2',
        messages: [
          { role: 'user', content: 'What is the weather?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_call',
                id: 'c1',
                name: 'weather',
                arguments: { location: 'SF' },
              },
            ],
          },
          {
            role: 'tool',
            name: 'weather',
            content: [{ type: 'tool_result', toolCallId: 'c1', name: 'weather', content: '65F' }],
          },
          { role: 'assistant', content: 'It is 65F in SF.' },
        ],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    expect(turn2.appendedCount).toBe(4);
    expect(turn2.totalConversationMessages).toBe(6);
    expect(turn2.messages[0]!.sequenceNumber).toBe(3);
    expect(turn2.messages[1]!.sequenceNumber).toBe(4);
    expect(turn2.messages[2]!.sequenceNumber).toBe(5);
    expect(turn2.messages[3]!.sequenceNumber).toBe(6);

    // List messages verifies deterministic ordering
    const listRes = await listMessagesUseCase.execute(conv.id, {}, { tenantId: 'tenant-1' });
    expect(listRes.messages.length).toBe(6);
    for (let i = 0; i < listRes.messages.length; i++) {
      expect(listRes.messages[i]!.sequenceNumber).toBe(i + 1);
    }
  });

  it('supports cursor pagination on sequence numbers', async () => {
    const conv = await createUseCase.execute(
      { title: 'Chat' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    await appendUseCase.execute(
      conv.id,
      {
        turnId: 'turn-1',
        messages: [
          { role: 'user', content: '1' },
          { role: 'assistant', content: '2' },
          { role: 'user', content: '3' },
          { role: 'assistant', content: '4' },
          { role: 'user', content: '5' },
        ],
      },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    const page1 = await listMessagesUseCase.execute(
      conv.id,
      { limit: 2 },
      { tenantId: 'tenant-1' },
    );
    expect(page1.messages.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.messages[0]!.sequenceNumber).toBe(1);
    expect(page1.messages[1]!.sequenceNumber).toBe(2);

    const page2 = await listMessagesUseCase.execute(
      conv.id,
      { afterSequence: 2, limit: 2 },
      { tenantId: 'tenant-1' },
    );
    expect(page2.messages.length).toBe(2);
    expect(page2.messages[0]!.sequenceNumber).toBe(3);
    expect(page2.messages[1]!.sequenceNumber).toBe(4);
  });

  it('rejects appending to a soft-deleted conversation', async () => {
    const conv = await createUseCase.execute(
      { title: 'Chat' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    await deleteUseCase.execute(conv.id, { tenantId: 'tenant-1', hard: false });

    await expect(
      appendUseCase.execute(
        conv.id,
        { turnId: 'turn-1', messages: [{ role: 'user', content: 'hello' }] },
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).rejects.toThrow(ConversationDeletedError);
  });

  it('validates message input and throws for empty messages array or invalid role', async () => {
    const conv = await createUseCase.execute(
      { title: 'Chat' },
      { tenantId: 'tenant-1', userId: 'user-1' },
    );

    await expect(
      appendUseCase.execute(
        conv.id,
        { turnId: 'turn-1', messages: [] },
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).rejects.toThrow(InvalidRequestError);

    await expect(
      appendUseCase.execute(
        conv.id,
        {
          turnId: 'turn-1',
          messages: [{ role: 'hacker' as unknown as 'user', content: 'test' }],
        },
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).rejects.toThrow(InvalidRequestError);
  });

  it('throws ConversationNotFoundError for non-existent conversation', async () => {
    await expect(
      appendUseCase.execute(
        'conv_fake',
        { turnId: 'turn-1', messages: [{ role: 'user', content: 'test' }] },
        { tenantId: 'tenant-1', userId: 'user-1' },
      ),
    ).rejects.toThrow(ConversationNotFoundError);
  });
});
