import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatRepository } from '../../src/modules/chat/chat.repository';
import { ChatThread } from '../../src/models/ChatThread';

vi.mock('../../src/models/ChatThread', () => {
  return {
    ChatThread: {
      findOne: vi.fn(),
      create: vi.fn(),
      find: vi.fn(),
      findOneAndDelete: vi.fn(),
    },
  };
});

describe('ChatRepository Unit Tests', () => {
  let repo: ChatRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ChatRepository();
  });

  it('findByChatId queries ChatThread with chatId', async () => {
    const mockThread = { chatId: 'test-123', messages: [] };
    (ChatThread.findOne as any).mockResolvedValue(mockThread);

    const result = await repo.findByChatId('test-123');
    expect(ChatThread.findOne).toHaveBeenCalledWith({ chatId: 'test-123' });
    expect(result).toBe(mockThread);
  });

  it('createThread initializes thread with default title if omitted', async () => {
    const mockThread = { chatId: 'test-456', title: 'New Chat', messages: [] };
    (ChatThread.create as any).mockResolvedValue(mockThread);

    const result = await repo.createThread('test-456');
    expect(ChatThread.create).toHaveBeenCalledWith({
      chatId: 'test-456',
      title: 'New Chat',
      messages: [],
    });
    expect(result).toBe(mockThread);
  });

  it('findOrCreate returns existing thread if found', async () => {
    const mockThread = { chatId: 'existing-id', title: 'Existing Title', save: vi.fn() };
    (ChatThread.findOne as any).mockResolvedValue(mockThread);

    const result = await repo.findOrCreate('existing-id', 'New Title');
    expect(result).toBe(mockThread);
    expect(ChatThread.create).not.toHaveBeenCalled();
  });

  it('deleteThread calls findOneAndDelete', async () => {
    (ChatThread.findOneAndDelete as any).mockResolvedValue({ chatId: 'delete-id' });

    const deleted = await repo.deleteThread('delete-id');
    expect(ChatThread.findOneAndDelete).toHaveBeenCalledWith({ chatId: 'delete-id' });
    expect(deleted).toBe(true);
  });
});
