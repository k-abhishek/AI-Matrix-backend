import { ChatThread, IChatThread, IChatMessage } from '../../models/ChatThread';

export interface ChatThreadSummary {
  chatId: string;
  title: string;
  updatedAt?: Date;
  createdAt?: Date;
}

export class ChatRepository {
  /**
   * Retrieves a full chat thread by its unique chatId.
   */
  async findByChatId(chatId: string): Promise<IChatThread | null> {
    return ChatThread.findOne({ chatId });
  }

  /**
   * Creates a new chat thread document with an optional title.
   */
  async createThread(chatId: string, title?: string): Promise<IChatThread> {
    return ChatThread.create({
      chatId,
      title: title || 'New Chat',
      messages: [],
    });
  }

  /**
   * Finds an existing thread or creates it if not found.
   */
  async findOrCreate(chatId: string, initialTitle?: string): Promise<IChatThread> {
    let thread = await this.findByChatId(chatId);
    if (!thread) {
      thread = await this.createThread(chatId, initialTitle);
    } else if (initialTitle && (!thread.title || thread.title.trim() === '')) {
      thread.title = initialTitle;
      await thread.save();
    }
    return thread;
  }

  /**
   * Appends messages to an existing thread and optionally updates the title.
   */
  async appendMessages(
    chatId: string,
    messages: IChatMessage[],
    title?: string
  ): Promise<IChatThread | null> {
    const thread = await this.findByChatId(chatId);
    if (!thread) {
      return null;
    }

    if (title && (!thread.title || thread.title.trim() === '')) {
      thread.title = title;
    }

    for (const msg of messages) {
      thread.messages.push(msg);
    }

    await thread.save();
    return thread;
  }

  /**
   * Updates the cumulative epoch summary and summarized message count for a thread.
   */
  async updateSummary(
    chatId: string,
    summary: string,
    summarizedMessageCount: number
  ): Promise<IChatThread | null> {
    return ChatThread.findOneAndUpdate(
      { chatId },
      { $set: { summary, summarizedMessageCount } },
      { new: true }
    );
  }

  /**
   * Retrieves a lightweight list of conversation threads sorted by recency.
   */
  async listThreads(limit = 50): Promise<ChatThreadSummary[]> {
    const threads = await ChatThread.find({}, { chatId: 1, title: 1, messages: 1, updatedAt: 1, createdAt: 1 })
      .slice('messages', 1)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

    return threads.map((thread: any) => {
      let title = thread.title;
      if (!title || title.trim() === '') {
        title =
          thread.messages?.[0]?.content?.trim().replace(/\s+/g, ' ').slice(0, 50) ||
          'New Chat';
      }
      return {
        chatId: thread.chatId,
        title,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
      };
    });
  }

  /**
   * Deletes a chat conversation thread by chatId.
   */
  async deleteThread(chatId: string): Promise<boolean> {
    const result = await ChatThread.findOneAndDelete({ chatId });
    return !!result;
  }
}

export const chatRepository = new ChatRepository();
export default chatRepository;
