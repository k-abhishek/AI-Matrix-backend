import { describe, it, expect } from 'vitest';
import { ChatThread } from '../../src/models/ChatThread';

describe('ChatThread Model', () => {
  it('should instantiate a chat thread with default values', () => {
    const thread = new ChatThread({
      chatId: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Conversation',
      messages: [
        {
          role: 'user',
          content: 'Hello, world!',
        },
        {
          role: 'assistant',
          content: 'Hi there!',
          toolCalls: [
            {
              name: 'search_knowledge_base',
              args: { query: 'test query' },
              output: 'Example Content',
              toolCallId: 'call_1',
            },
          ],
          citations: [
            {
              pageId: 'page-123',
              crawlerId: 'crawler-456',
              url: 'https://example.com/docs',
              title: 'Docs',
              score: 0.88,
              snippet: 'Example snippet',
            },
          ],
        },
      ],
    });

    expect(thread.chatId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(thread.title).toBe('Test Conversation');
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].role).toBe('user');
    expect(thread.messages[0].content).toBe('Hello, world!');
    expect(thread.messages[1].role).toBe('assistant');
    expect(thread.messages[1].toolCalls).toHaveLength(1);
    expect(thread.messages[1].toolCalls?.[0].name).toBe('search_knowledge_base');
    expect(thread.messages[1].citations).toHaveLength(1);
    expect(thread.messages[1].citations?.[0].pageId).toBe('page-123');
    expect(thread.messages[1].citations?.[0].url).toBe('https://example.com/docs');
  });
});

