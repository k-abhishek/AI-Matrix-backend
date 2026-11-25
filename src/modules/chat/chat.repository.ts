import { ChatThread, IChatThread, IChatMessage } from '../../models/ChatThread';

export interface ChatThreadSummary {
  chatId: string;
  title: string;
  updatedAt?: Date;
  createdAt?: Date;
}

export interface ChatThreadScope {
  workspaceId?: string;
  userId?: string;
  agentId?: string;
  agentVersionId?: string;
}

export class ChatRepository {
  /**
   * Builds a MongoDB filter scoped by workspaceId (and optionally userId) when provided.
   */
  private buildScopeFilter(chatId?: string, scope?: ChatThreadScope): Record<string, any> {
    const filter: Record<string, any> = {};
    if (chatId !== undefined) {
      filter.chatId = chatId;
    }
    if (scope?.workspaceId) {
      filter.workspaceId = scope.workspaceId;
    }
    if (scope?.userId) {
      filter.userId = scope.userId;
    }
    return filter;
  }

  /**
   * Retrieves a full chat thread by its unique chatId (optionally scoped to workspace/user).
   */
  async findByChatId(chatId: string, scope?: ChatThreadScope): Promise<IChatThread | null> {
    return ChatThread.findOne(this.buildScopeFilter(chatId, scope));
  }

  /**
   * Creates a new chat thread document with an optional title, tenant scope, and initial messages.
   */
  async createThread(
    chatId: string,
    title?: string,
    scope?: ChatThreadScope,
    initialMessages: IChatMessage[] = []
  ): Promise<IChatThread> {
    return ChatThread.create({
      chatId,
      ...(scope?.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      ...(scope?.userId ? { userId: scope.userId } : {}),
      ...(scope?.agentId ? { agentId: scope.agentId } : {}),
      ...(scope?.agentVersionId ? { agentVersionId: scope.agentVersionId } : {}),
      title: title || 'New Chat',
      messages: initialMessages,
    });
  }

  /**
   * Finds an existing thread or creates it if not found.
   */
  async findOrCreate(
    chatId: string,
    initialTitle?: string,
    scope?: ChatThreadScope
  ): Promise<IChatThread> {
    let thread = await this.findByChatId(chatId, scope);
    if (!thread) {
      thread = await this.createThread(chatId, initialTitle, scope);
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
  async listThreads(limit = 50, scope?: ChatThreadScope): Promise<ChatThreadSummary[]> {
    const filter = {
      ...this.buildScopeFilter(undefined, scope),
      status: { $ne: 'ARCHIVED' },
    };
    const threads = await ChatThread.find(
      filter,
      { chatId: 1, title: 1, messages: 1, updatedAt: 1, createdAt: 1 }
    )
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
   * Deletes a chat conversation thread by chatId (optionally scoped to workspace/user).
   */
  async deleteThread(chatId: string, scope?: ChatThreadScope): Promise<boolean> {
    const result = await ChatThread.findOneAndDelete(this.buildScopeFilter(chatId, scope));
    return !!result;
  }
}

export const chatRepository = new ChatRepository();
export default chatRepository;
