import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';

describe('Connector Platform API Endpoints (Phase 1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/connectors/catalog', () => {
    it('returns catalog of native and generic connectors', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/connectors/catalog',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_phase1',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(5);

      const keys = json.data.map((c: any) => c.key);
      expect(keys).toContain('gmail');
      expect(keys).toContain('slack');
      expect(keys).toContain('github');
      expect(keys).toContain('mcp-server');
      expect(keys).toContain('custom-rest');
    });

    it('filters catalog by connector type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/connectors/catalog?type=MCP',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_phase1',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.length).toBeGreaterThanOrEqual(1);
      const keys = json.data.map((c: any) => c.key);
      expect(keys).toContain('mcp-server');
      expect(keys).toContain('gmail');
      expect(keys).toContain('slack');
    });

    it('GET /api/connectors/catalog/:key returns connector details', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/connectors/catalog/slack',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_phase1',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.key).toBe('slack');
      expect(json.data.name).toBe('Slack');
      expect(json.data.supportedAuth).toContain('OAUTH2_AUTHORIZATION_CODE');
    });

    it('GET /api/connectors/catalog/:key returns 404 for nonexistent key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/connectors/catalog/nonexistent-connector-key',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_phase1',
        },
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.success).toBe(false);
    });
  });

  describe('Connection Management Endpoints', () => {
    it('POST /api/connections validates required fields with Zod', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/connections',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_phase1',
        },
        payload: {
          // Missing name and authType
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe('Validation failed');
    });

    it('rejects unauthenticated requests with 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/connections',
        headers: {
          'x-test-bypass': 'false',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.success).toBe(false);
    });
  });
});
