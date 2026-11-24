import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';
import mcpDiscoveryService from '../../src/modules/mcp/mcp-discovery.service';
import connectionService from '../../src/modules/connections/connection.service';

describe('MCP API Endpoints (Phase 2)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/mcp/discover', () => {
    it('returns 401 when unauthenticated', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mcp/discover',
        payload: {
          serverUrl: 'https://mcp.weather.internal/mcp',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when serverUrl is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mcp/discover',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_mcp',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
    });

    it('rejects private and loopback URLs with 403 Forbidden (SSRF Guard)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mcp/discover',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_mcp',
        },
        payload: {
          serverUrl: 'http://169.254.169.254/latest/meta-data',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('probes a remote MCP server and returns discovered capabilities and tools', async () => {
      vi.spyOn(mcpDiscoveryService, 'probeServer').mockResolvedValue({
        isHealthy: true,
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: true,
          resources: true,
          prompts: true,
          logging: true,
        },
        tools: [
          {
            name: 'weather_get_forecast',
            displayName: 'Weather Get Forecast',
            description: 'Returns weather forecast for coordinates',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
            schemaHash: 'sha256-mock-hash',
            requiresApproval: false,
          },
        ],
        resources: [
          {
            uri: 'weather://alerts/active',
            name: 'Active Weather Alerts',
            description: 'Live alerts',
          },
        ],
        prompts: [],
        latencyMs: 45,
        testedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/mcp/discover',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_mcp',
        },
        payload: {
          serverUrl: 'https://93.184.216.34/mcp',
          transport: 'STREAMABLE_HTTP',
          auth: {
            type: 'BEARER_TOKEN',
            token: 'test_token_123',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.isHealthy).toBe(true);
      expect(json.data.tools.length).toBe(1);
      expect(json.data.tools[0].name).toBe('weather_get_forecast');
      expect(json.data.resources.length).toBe(1);
    });
  });

  describe('Connection Tools & Execution Endpoints', () => {
    it('retrieves tools for an active connection via GET /api/connections/:id/tools', async () => {
      vi.spyOn(connectionService, 'getConnectionTools').mockResolvedValue([
        {
          id: 'tool_1',
          connectionId: 'conn_123',
          name: 'calendar_list_events',
          displayName: 'Calendar List Events',
          description: 'Lists events from Google Calendar',
          inputSchema: { type: 'object' },
          outputSchema: null,
          schemaHash: 'hash123',
          isEnabled: true,
          requiresApproval: false,
          rateLimitPerMin: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/connections/11111111-2222-3333-4444-555555555555/tools',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_mcp',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data[0].name).toBe('calendar_list_events');
    });

    it('triggers discovery on an active connection via POST /api/connections/:id/discover', async () => {
      vi.spyOn(connectionService, 'discoverConnection').mockResolvedValue({
        connectionId: 'conn_123',
        toolsCount: 2,
        resourcesCount: 1,
        promptsCount: 0,
        tools: [],
        resources: [],
        prompts: [],
        discoveredAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/connections/11111111-2222-3333-4444-555555555555/discover',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_mcp',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.toolsCount).toBe(2);
    });

    it('executes a tool on an active connection via POST /api/connections/:id/execute', async () => {
      vi.spyOn(connectionService, 'executeTool').mockResolvedValue({
        success: true,
        data: { message: 'Event created' },
        durationMs: 120,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/connections/11111111-2222-3333-4444-555555555555/execute',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_mcp',
        },
        payload: {
          toolName: 'calendar_create_event',
          parameters: { title: 'Team Sync' },
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.data).toEqual({ message: 'Event created' });
    });
  });
});
