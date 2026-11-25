import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphBuilderService } from '../../src/modules/runtime/graph-builder.service';
import { GraphCacheService } from '../../src/modules/runtime/graph-cache.service';
import { WorkflowSubgraphBuilder } from '../../src/modules/skills/workflow-subgraph.builder';
import { AgentRuntimeService } from '../../src/modules/runtime/agent-runtime.service';
import mongoCheckpointSaver, { MongoCheckpointSaver } from '../../src/modules/runtime/mongo-checkpointer.service';
import { LangGraphCheckpoint, LangGraphCheckpointWrite } from '../../src/models/LangGraphCheckpoint';
import { AgentRun, AgentExecutionEvent } from '../../src/models/AgentRun';
import contextWindowService from '../../src/services/contextWindow.service';
import prisma from '../../src/lib/prisma';
import chatRepository from '../../src/modules/chat/chat.repository';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { BadRequestError, ForbiddenError } from '../../src/lib/errors';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    agent: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/modules/chat/chat.repository', () => ({
  default: {
    findByChatId: vi.fn(),
    createThread: vi.fn(),
    appendMessages: vi.fn(),
  },
}));

describe('LangGraph Runtime, Cache, Workflow DAG & Pinning Tests (Steps 3-9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GraphBuilderService omits search_knowledge_base when 0 KBs and registers load_skill when skills exist', async () => {
    const builder = new GraphBuilderService();
    const fakeModel: any = {
      bindTools: vi.fn((tools: any[]) => {
        expect(tools.map((t) => t.name)).not.toContain('search_knowledge_base');
        expect(tools.map((t) => t.name)).toContain('load_skill');
        return {
          invoke: vi.fn().mockResolvedValue(new AIMessage('Hello without KB!')),
        };
      }),
      invoke: vi.fn().mockResolvedValue(new AIMessage('Hello without KB!')),
    };

    const compiled = builder.buildGraph({
      model: fakeModel,
      systemInstructions: 'Be concise.',
      maxIterations: 5,
      workspaceId: 'org_1',
      knowledgeBaseIds: [],
      skills: [
        {
          key: 'seo-writer',
          name: 'SEO Writer',
          summary: 'Write SEO content',
          instructions: 'Use H1/H2 headings.',
        },
      ],
      tools: [],
      approvalRequiredTools: new Set(),
    });

    const out = await compiled.invoke({ messages: [] });
    expect(out.messages.at(-1)?.content).toBe('Hello without KB!');
  });

  it('GraphCacheService evicts LRU and invalidates by versionId', () => {
    const cache = new GraphCacheService(2);
    const k1 = cache.buildKey('v1', 'h1', 't1');
    const k2 = cache.buildKey('v2', 'h2', 't2');
    const k3 = cache.buildKey('v3', 'h3', 't3');

    cache.set(k1, 'g1');
    cache.set(k2, 'g2');
    cache.get(k1); // refresh k1
    cache.set(k3, 'g3'); // evicts k2

    expect(cache.get(k2)).toBeUndefined();
    expect(cache.get(k1)).toBe('g1');
    cache.invalidateByVersion('v1');
    expect(cache.get(k1)).toBeUndefined();
  });

  it('WorkflowSubgraphBuilder validates DAG edges and rejects unknown target nodes', () => {
    const wf = new WorkflowSubgraphBuilder();
    expect(() =>
      wf.validateDefinition({
        entryNodeId: 'start_node',
        maxIterations: 5,
        nodes: [{ id: 'start_node', type: 'llm', next: 'missing_node' }],
      })
    ).toThrow(BadRequestError);
  });

  it('AgentRuntimeService blocks execution of a REVOKED agent version', async () => {
    const runtime = new AgentRuntimeService();
    vi.mocked(chatRepository.findByChatId).mockResolvedValue(null);
    vi.mocked(prisma.agent.findUnique).mockResolvedValue({
      id: 'agent-1',
      workspaceId: 'org_1',
      ownerUserId: 'user_1',
      visibility: 'WORKSPACE',
      status: 'ACTIVE',
      activeVersionId: 'ver-revoked',
      versions: [{ id: 'ver-revoked', status: 'REVOKED' }],
    } as any);

    await expect(
      runtime.resolveExecutionVersion(
        {
          workspaceId: 'org_1',
          userId: 'user_1',
          orgId: 'org_1',
          orgRole: 'org:member',
          isOrganization: true,
        },
        { agentId: 'agent-1', prompt: 'hi' }
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it('AgentRuntimeService persists streamed response and emits onDone when stream parser errors at EOF', async () => {
    const runtime = new AgentRuntimeService();
    vi.spyOn(AgentRun, 'create').mockResolvedValue({} as any);
    vi.spyOn(AgentRun, 'updateOne').mockResolvedValue({} as any);
    vi.spyOn(AgentExecutionEvent, 'create').mockResolvedValue({} as any);
    vi.spyOn(mongoCheckpointSaver, 'getTuple').mockResolvedValue({ checkpoint: {} } as any);
    vi.mocked(chatRepository.findByChatId).mockResolvedValue({
      chatId: 'chat-2',
      messages: [
        { role: 'user', content: 'first', createdAt: new Date() },
        { role: 'assistant', content: 'first reply', createdAt: new Date() },
      ],
    } as any);
    vi.mocked(chatRepository.appendMessages).mockResolvedValue({} as any);
    const prepareSpy = vi.spyOn(contextWindowService, 'prepareMessages');

    const fakeCompiledGraph = {
      streamEvents: vi.fn(async function* () {
        yield { event: 'on_chat_model_stream', data: { chunk: { content: 'Hello ' } } };
        yield { event: 'on_chat_model_stream', data: { chunk: { content: 'world' } } };
        throw new Error('[GoogleGenerativeAI Error]: Failed to parse stream');
      }),
      getState: vi.fn().mockResolvedValue({ tasks: [] }),
    };
    const compileSpy = vi
      .spyOn(runtime as any, 'compileForAgentOrDefault')
      .mockResolvedValue({ compiledGraph: fakeCompiledGraph, maxIterations: 15, timeoutMs: 60000 });

    const statuses: string[] = [];
    const tokens: string[] = [];
    let donePayload: any = null;
    let errorPayload: Error | null = null;

    await runtime.streamExecution(
      { workspaceId: 'org_1', userId: 'user_1', isOrganization: true },
      { chatId: 'chat-2', prompt: 'second' },
      {
        onStatus: (d) => statuses.push(d.status),
        onToken: (t) => tokens.push(t),
        onDone: (d) => {
          donePayload = d;
        },
        onError: (e) => {
          errorPayload = e;
        },
      }
    );

    expect(errorPayload).toBeNull();
    expect(prepareSpy).not.toHaveBeenCalled();
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(fakeCompiledGraph.streamEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        iterationCount: 0,
        messages: [expect.any(HumanMessage)],
      }),
      expect.anything()
    );
    expect(tokens.join('')).toBe('Hello world');
    expect(statuses).not.toContain('Done');
    expect(chatRepository.appendMessages).toHaveBeenCalledWith(
      'chat-2',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'second' }),
        expect.objectContaining({ role: 'assistant', content: 'Hello world' }),
      ])
    );
    expect(donePayload).toEqual(
      expect.objectContaining({ chatId: 'chat-2', message: 'Hello world' })
    );
  });

  it('AgentRuntimeService falls back to non-streaming invoke when stream fails before emitting tokens', async () => {
    const runtime = new AgentRuntimeService();
    vi.spyOn(AgentRun, 'create').mockResolvedValue({} as any);
    vi.spyOn(AgentRun, 'updateOne').mockResolvedValue({} as any);
    vi.spyOn(AgentExecutionEvent, 'create').mockResolvedValue({} as any);
    vi.spyOn(mongoCheckpointSaver, 'getTuple').mockResolvedValue(undefined);
    vi.mocked(chatRepository.findByChatId).mockResolvedValue(null);
    vi.mocked(chatRepository.createThread).mockResolvedValue({} as any);
    vi.mocked(chatRepository.appendMessages).mockResolvedValue({} as any);

    const streamingGraph = {
      streamEvents: vi.fn(async function* () {
        throw new Error('[GoogleGenerativeAI Error]: Failed to parse stream');
      }),
      getState: vi.fn().mockResolvedValue({ tasks: [] }),
    };
    const fallbackGraph = {
      invoke: vi.fn().mockResolvedValue({ messages: [new AIMessage('Fallback reply')] }),
    };

    vi.spyOn(runtime as any, 'compileForAgentOrDefault')
      .mockResolvedValueOnce({ compiledGraph: streamingGraph, maxIterations: 15, timeoutMs: 60000 })
      .mockResolvedValueOnce({ compiledGraph: fallbackGraph, maxIterations: 15, timeoutMs: 60000 });

    const tokens: string[] = [];
    let donePayload: any = null;

    await runtime.streamExecution(
      { workspaceId: 'org_1', userId: 'user_1', isOrganization: true },
      { chatId: 'chat-3', prompt: 'hello' },
      {
        onToken: (t) => tokens.push(t),
        onDone: (d) => {
          donePayload = d;
        },
      }
    );

    expect(streamingGraph.streamEvents).toHaveBeenCalledTimes(2);
    expect(fallbackGraph.invoke).toHaveBeenCalledTimes(1);
    expect(tokens).toEqual(['Fallback reply']);
    expect(chatRepository.appendMessages).toHaveBeenCalledWith(
      'chat-3',
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'hello' }),
        expect.objectContaining({ role: 'assistant', content: 'Fallback reply' }),
      ])
    );
    expect(donePayload).toEqual(
      expect.objectContaining({ chatId: 'chat-3', message: 'Fallback reply' })
    );
  });

  it('MongoCheckpointSaver.getTuple deserializes checkpoint, metadata, and pending writes without iterable error', async () => {
    const saver = new MongoCheckpointSaver();
    const [, cpBytes] = await (saver as any).serde.dumpsTyped({
      v: 1,
      id: 'cp-1',
      ts: '2026-01-01T00:00:00.000Z',
      channel_values: { messages: [] },
      channel_versions: {},
      versions_seen: {},
    });
    const [, metaBytes] = await (saver as any).serde.dumpsTyped({ source: 'loop', step: 1 });
    const [writeType, writeBytes] = await (saver as any).serde.dumpsTyped({ ok: true });

    vi.spyOn(LangGraphCheckpoint, 'findOne').mockReturnValue({
      sort: () => ({
        lean: async () => ({
          threadId: 'thread-1',
          checkpointNs: '',
          checkpointId: 'cp-1',
          checkpoint: Buffer.from(cpBytes).toString('base64'),
          metadata: Buffer.from(metaBytes).toString('base64'),
        }),
      }),
    } as any);

    vi.spyOn(LangGraphCheckpointWrite, 'find').mockReturnValue({
      lean: async () => [
        {
          taskId: 'task-1',
          taskPath: '',
          idx: 0,
          channel: 'messages',
          type: writeType,
          value: Buffer.from(writeBytes).toString('base64'),
        },
      ],
    } as any);

    const tuple = await saver.getTuple({ configurable: { thread_id: 'thread-1' } });
    expect(tuple?.checkpoint.id).toBe('cp-1');
    expect(tuple?.metadata).toEqual({ source: 'loop', step: 1 });
    expect(tuple?.pendingWrites).toEqual([['task-1', 'messages', { ok: true }]]);
  });
});
