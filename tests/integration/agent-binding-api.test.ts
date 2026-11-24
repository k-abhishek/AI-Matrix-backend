import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';
import agentBindingService from '../../src/modules/agents/agent-binding.service';

describe('Agent Connector Binding API Endpoints (Phase 4)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/agents/:agentId/connectors', () => {
    it('creates or upserts an agent connector binding', async () => {
      vi.spyOn(agentBindingService, 'createBinding').mockResolvedValue({
        id: 'binding-uuid-1',
        agentId: 'agent-finance',
        workspaceId: 'test_ws',
        connectionId: '11111111-2222-3333-4444-555555555555',
        allowedToolNames: ['send_email', 'search_messages'],
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        connection: {
          id: '11111111-2222-3333-4444-555555555555',
          name: 'Corporate Gmail',
          connectorDefinition: {
            key: 'gmail',
            name: 'Gmail',
          },
        },
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-finance/connectors',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_ws',
        },
        payload: {
          connectionId: '11111111-2222-3333-4444-555555555555',
          allowedToolNames: ['send_email', 'search_messages'],
          isEnabled: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.agentId).toBe('agent-finance');
      expect(json.data.allowedToolNames).toContain('send_email');
      expect(agentBindingService.createBinding).toHaveBeenCalledWith(
        'agent-finance',
        'test_ws',
        expect.objectContaining({
          connectionId: '11111111-2222-3333-4444-555555555555',
          allowedToolNames: ['send_email', 'search_messages'],
        })
      );
    });

    it('rejects missing or invalid connectionId format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agents/agent-finance/connectors',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_ws',
        },
        payload: {
          connectionId: 'not-a-valid-uuid',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/agents/:agentId/connectors', () => {
    it('returns list of connector bindings for the agent', async () => {
      vi.spyOn(agentBindingService, 'listBindings').mockResolvedValue([
        {
          id: 'binding-uuid-1',
          agentId: 'agent-finance',
          workspaceId: 'test_ws',
          connectionId: '11111111-2222-3333-4444-555555555555',
          allowedToolNames: ['send_email'],
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          connection: {
            id: '11111111-2222-3333-4444-555555555555',
            name: 'Corporate Gmail',
          },
        },
      ] as any);

      const response = await app.inject({
        method: 'GET',
        url: '/api/agents/agent-finance/connectors',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_ws',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBe(1);
      expect(json.data[0].agentId).toBe('agent-finance');
    });
  });

  describe('PATCH /api/agents/:agentId/connectors/:connectionId', () => {
    it('updates binding permissions and enabled status', async () => {
      vi.spyOn(agentBindingService, 'updateBinding').mockResolvedValue({
        id: 'binding-uuid-1',
        agentId: 'agent-finance',
        workspaceId: 'test_ws',
        connectionId: '11111111-2222-3333-4444-555555555555',
        allowedToolNames: ['send_email'],
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/agents/agent-finance/connectors/11111111-2222-3333-4444-555555555555',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_ws',
        },
        payload: {
          isEnabled: false,
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.isEnabled).toBe(false);
    });
  });

  describe('DELETE /api/agents/:agentId/connectors/:connectionId', () => {
    it('deletes agent connector binding successfully', async () => {
      vi.spyOn(agentBindingService, 'deleteBinding').mockResolvedValue(undefined as any);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/agents/agent-finance/connectors/11111111-2222-3333-4444-555555555555',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_ws',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(agentBindingService.deleteBinding).toHaveBeenCalledWith(
        'agent-finance',
        '11111111-2222-3333-4444-555555555555',
        'test_ws'
      );
    });
  });
});
