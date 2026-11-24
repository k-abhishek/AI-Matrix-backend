import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import buildApp from '../../src/app';
import authManager from '../../src/modules/connections/auth.manager';

describe('OAuth & Auth Lifecycle Endpoints (Phase 3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/connections/:id/auth', () => {
    it('saves direct API key credentials into vault and returns success', async () => {
      vi.spyOn(authManager, 'saveDirectCredentials').mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/connections/11111111-2222-3333-4444-555555555555/auth',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_oauth',
        },
        payload: {
          apiKey: 'test_api_key_secret_123',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.message).toContain('Credentials encrypted');
    });

    it('initiates OAuth flow and returns authorization URL with state', async () => {
      vi.spyOn(authManager, 'initiateOAuth').mockResolvedValue({
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...',
        state: 'secure_state_token_123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/connections/11111111-2222-3333-4444-555555555555/auth',
        headers: {
          'x-test-bypass': 'true',
          'x-test-user-id': 'test_user_oauth',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.authorizationUrl).toContain('accounts.google.com');
      expect(json.state).toBe('secure_state_token_123');
    });
  });

  describe('GET /api/oauth/callback', () => {
    it('rejects missing code or state with 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?state=only_state',
      });

      expect(response.statusCode).toBe(400);
    });

    it('exchanges code for tokens and redirects or returns JSON response', async () => {
      vi.spyOn(authManager, 'handleOAuthCallback').mockResolvedValue({
        connectionId: 'conn_123',
        status: 'CONNECTED',
        redirectUrl: 'http://localhost:5173/connector?connectionId=conn_123&status=success',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/oauth/callback?code=test_code&state=test_state',
        headers: {
          Accept: 'application/json',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.connectionId).toBe('conn_123');
      expect(json.status).toBe('CONNECTED');
    });
  });
});
