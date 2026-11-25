import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';
import chatService from '../../src/modules/chat/chat.service';
import agentRuntimeService from '../../src/modules/runtime/agent-runtime.service';

describe('Aligned /api/chat, SSE Streaming & HITL Resumption', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/chat initializes thread non-blockingly and returns 201', async () => {
    const initSpy = vi.spyOn(chatService, 'initializeThread').mockResolvedValue({
      chatId: 'chat-uuid-1',
      agentId: 'agent-exec',
      agentVersionId: 'ver-uuid-1',
      title: 'Find my meeting on Slack',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user-1',
        'x-test-org-id': 'workspace-xyz',
      },
      payload: {
        prompt: 'Find my meeting on Slack',
        agentId: 'agent-exec',
      },
    });

    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json).toEqual({
      success: true,
      data: {
        chatId: 'chat-uuid-1',
        agentId: 'agent-exec',
        agentVersionId: 'ver-uuid-1',
        title: 'Find my meeting on Slack',
      },
    });

    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-xyz',
        userId: 'user-1',
      }),
      {
        prompt: 'Find my meeting on Slack',
        agentId: 'agent-exec',
      }
    );
  });

  it('POST /api/chat/stream emits SSE events via AgentRuntimeService', async () => {
    vi.spyOn(agentRuntimeService, 'streamExecution').mockImplementation(
      async (_ctx, _input, callbacks) => {
        callbacks.onInit?.({ chatId: 'chat-uuid-1' });
        callbacks.onToken?.('Hello ');
        callbacks.onDone?.({
          chatId: 'chat-uuid-1',
          message: 'Hello world',
          toolCalls: [],
          citations: [],
        });
      }
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/stream',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user-1',
        'x-test-org-id': 'workspace-xyz',
      },
      payload: {
        chatId: 'chat-uuid-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('event: init');
    expect(response.body).toContain('event: token');
    expect(response.body).toContain('event: done');
  });

  it('POST /api/chat/approve resumes paused turn and streams SSE response', async () => {
    const resumeSpy = vi
      .spyOn(agentRuntimeService, 'resumeApprovalStream')
      .mockImplementation(async (_ctx, _approvalId, _approved, callbacks) => {
        callbacks.onInit?.({ chatId: 'chat-uuid-1' });
        callbacks.onToken?.('Email sent.');
        callbacks.onDone?.({
          chatId: 'chat-uuid-1',
          message: 'Email sent.',
          toolCalls: [],
          citations: [],
        });
      });

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/approve',
      headers: {
        'x-test-bypass': 'true',
        'x-test-user-id': 'user-1',
        'x-test-org-id': 'workspace-xyz',
      },
      payload: {
        approvalId: 'approval-uuid-1',
        approved: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('Email sent.');
    expect(resumeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-xyz', userId: 'user-1' }),
      'approval-uuid-1',
      true,
      expect.any(Object),
      expect.any(Object)
    );
  });
});
