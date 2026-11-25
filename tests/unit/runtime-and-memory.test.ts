import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphBuilderService } from '../../src/modules/runtime/graph-builder.service';
import { GraphCacheService } from '../../src/modules/runtime/graph-cache.service';
import { AgentRuntimeService } from '../../src/modules/runtime/agent-runtime.service';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { HumanMessage } from '@langchain/core/messages';
import prisma from '../../src/lib/prisma';
import chatRepository from '../../src/modules/chat/chat.repository';
import { ForbiddenError } from '../../src/lib/errors';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    agent: { findUnique: vi.fn() },
  },
}));

describe('Runtime, GraphCache, GraphBuilder & Version Pinning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GraphCacheService caches, retrieves, and invalidates by agentVersionId', () => {
    const cache = new GraphCacheService(10);
    const key = cache.buildKey('ver-1', 'hash-a', 'tools-1');
    cache.set(key, { compiled: true });
    expect(cache.get(key)).toEqual({ compiled: true });
    expect(cache.invalidateByVersion('ver-1')).toBe(1);
    expect(cache.get(key)).toBeUndefined();
  });

  it('GraphBuilderService runs cleanly with 0 knowledge bases and 0 skills', async () => {
    const builder = new GraphBuilderService();
    const fakeModel = new FakeListChatModel({ responses: ['Hello without KB!'] });

    const graph = builder.buildGraph({
      model: fakeModel as any,
      systemInstructions: 'Be concise.',
      maxIterations: 5,
      workspaceId: 'org_1',
      knowledgeBaseIds: [],
      skills: [],
      tools: [],
      approvalRequiredTools: new Set(),
    });

    const result = await graph.invoke({ messages: [new HumanMessage('Hi')] });
    expect(result.messages.at(-1)?.content).toBe('Hello without KB!');
  });

  it('AgentRuntimeService blocks execution when pinned version is REVOKED', async () => {
    const runtime = new AgentRuntimeService();
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: 'agent-1',
      workspaceId: 'org_1',
      visibility: 'WORKSPACE',
      ownerUserId: 'user_1',
      status: 'ACTIVE',
      activeVersionId: 'ver-1',
      versions: [{ id: 'ver-1', status: 'REVOKED' }],
    } as any);

    vi.spyOn(chatRepository, 'findByChatId').mockResolvedValue({
      chatId: 'chat-1',
      agentVersionId: 'ver-1',
    } as any);

    await expect(
      runtime.resolveExecutionVersion(
        { workspaceId: 'org_1', userId: 'user_1', isOrganization: true },
        { agentId: 'agent-1', prompt: 'hi', chatId: 'chat-1' }
      )
    ).rejects.toThrow(ForbiddenError);
  });
});
