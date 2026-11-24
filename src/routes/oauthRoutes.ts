import { FastifyPluginAsync } from 'fastify';
import authManager from '../modules/connections/auth.manager';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { BadRequestError } from '../lib/errors';

/**
 * Fastify route plugin for OAuth 2.0 and connection authentication lifecycle.
 */
const oauthRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/connections/:id/auth
   * Initiates authentication for a connection.
   * If credentials (e.g. API key / token) are passed in body, stores them directly in vault.
   * Otherwise, generates PKCE code challenge and returns OAuth authorization URL.
   */
  fastify.post<{
    Params: { id: string };
    Body?: {
      credentials?: Record<string, any>;
      apiKey?: string;
      token?: string;
      redirectBaseUrl?: string;
    };
  }>(
    '/connections/:id/auth',
    {
      preHandler: requireAuth,
      schema: {
        tags: ['Connections'],
        summary: 'Initiate connection authentication or save credentials',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          properties: {
            credentials: { type: 'object', additionalProperties: true },
            apiKey: { type: 'string' },
            token: { type: 'string' },
            redirectBaseUrl: { type: 'string', format: 'uri' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              authorizationUrl: { type: 'string', nullable: true },
              state: { type: 'string', nullable: true },
              message: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const authReq = request as AuthenticatedRequest;
      const workspaceId = authReq.auth?.orgId || authReq.userId || 'default_user';
      const body = request.body || {};

      // Direct credential submission (API key or Bearer token)
      if (body.credentials || body.apiKey || body.token) {
        const credentials = body.credentials || {
          apiKey: body.apiKey,
          accessToken: body.token,
        };
        await authManager.saveDirectCredentials(id, workspaceId, credentials);
        return reply.send({
          success: true,
          message: 'Credentials encrypted and saved successfully',
        });
      }

      // OAuth flow initiation
      const { authorizationUrl, state } = await authManager.initiateOAuth(
        id,
        workspaceId,
        body.redirectBaseUrl
      );

      return reply.send({
        success: true,
        authorizationUrl,
        state,
      });
    }
  );

  /**
   * GET /api/oauth/callback
   * OAuth redirect callback endpoint. Exchanges authorization code for tokens,
   * encrypts them into vault, marks connection CONNECTED, and redirects to frontend.
   */
  fastify.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
  }>(
    '/oauth/callback',
    {
      schema: {
        tags: ['Connections'],
        summary: 'OAuth 2.0 authorization callback',
        querystring: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            state: { type: 'string' },
            error: { type: 'string' },
            error_description: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { code, state, error, error_description } = request.query;

      if (error) {
        throw new BadRequestError(`OAuth provider error: ${error_description || error}`);
      }

      if (!code || !state) {
        throw new BadRequestError('OAuth callback requires code and state parameters');
      }

      const result = await authManager.handleOAuthCallback(code, state);

      // If client requests JSON, return it; otherwise redirect to frontend
      const acceptHeader = request.headers['accept'] || '';
      if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
        return reply.send({
          success: true,
          connectionId: result.connectionId,
          status: result.status,
        });
      }

      return reply.redirect(result.redirectUrl);
    }
  );
};

export default oauthRoutes;
