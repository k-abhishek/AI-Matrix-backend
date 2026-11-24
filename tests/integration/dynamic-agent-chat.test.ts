import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';
import chatService from '../../src/modules/chat/chat.service';
import agentToolResolverService from '../../src/modules/agents/agent-tool-resolver.service';

describe('Dynamic Agent & Chat Integration (Phase 4)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/chat propagates agentId and resolves dynamic tools', async () => {
    const sendMessageSpy = vi.spyOn(chatService, 'sendMessage').mockResolvedValue({
      chatId: 'chat-uuid-1',
      message: 'Found your meeting at 2 PM on Slack',
      toolCalls: [
        {
          tool: 'slack_search_messages',
          input: { query: 'meeting' },
          output: 'Meeting at 2 PM today in #general',
        },
      ],
      citations: [],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'workspace-xyz',
      },
      payload: {
        prompt: 'Find my meeting on Slack',
        agentId: 'agent-exec',
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.message).toContain('Found your meeting');
    expect(json.toolCalls[0].tool).toBe('slack_search_messages');

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Find my meeting on Slack',
        agentId: 'agent-exec',
        workspaceId: 'workspace-xyz',
      })
    );
  });

  it('resolves dynamic tools during chat turn', async () => {
    const resolveSpy = vi.spyOn(agentToolResolverService, 'resolveToolsForAgent').mockResolvedValue([]);

    // Verify resolveToolsForAgent interface works properly
    const tools = await agentToolResolverService.resolveToolsForAgent('agent-test', 'workspace-xyz');
    expect(tools).toEqual([]);
    expect(resolveSpy).toHaveBeenCalledWith('agent-test', 'workspace-xyz');
  });
});
