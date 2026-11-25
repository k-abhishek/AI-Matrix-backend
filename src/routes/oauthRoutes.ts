import { FastifyPluginAsync } from 'fastify';
import authManager from '../modules/connections/auth.manager';
import { requireAuth, getWorkspaceContext } from '../middleware/auth';
import env from '../config/env';
import logger from '../lib/logger';

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
      const { workspaceId } = getWorkspaceContext(request);
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
      const frontendBase = env.FRONTEND_REDIRECT_BASE_URL.endsWith('/connector')
        ? env.FRONTEND_REDIRECT_BASE_URL
        : `${env.FRONTEND_REDIRECT_BASE_URL.replace(/\/+$/, '')}/connector`;

      const { code, state, error, error_description } = request.query;

      try {
        if (error) {
          logger.warn(`[OAuthRoutes] Provider returned error: ${error} - ${error_description}`);
          const failureUrl = `${frontendBase}?tab=connections&status=error&code=PROVIDER_DENIED`;
          return reply.redirect(failureUrl);
        }

        if (!code || !state) {
          const failureUrl = `${frontendBase}?tab=connections&status=error&code=INVALID_REQUEST`;
          const acceptHeader = request.headers['accept'] || '';
          if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
            return reply.status(400).send({
              error: {
                code: 'INVALID_REQUEST',
                message: 'OAuth callback requires code and state parameters',
              },
            });
          }
          return reply.redirect(failureUrl);
        }

        const result = await authManager.handleOAuthCallback(code, state);

        const successUrl = `${frontendBase}?tab=connections&status=success&connectionId=${encodeURIComponent(result.connectionId)}`;

        const acceptHeader = request.headers['accept'] || '';
        if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
          return reply.send({
            success: true,
            connectionId: result.connectionId,
            status: result.status,
            redirectUrl: successUrl,
          });
        }

        return reply.redirect(successUrl);
      } catch (err: any) {
        logger.error(`[OAuthRoutes] Callback failed: ${err.message}`, err);
        let errorCode = 'OAUTH_FAILED';
        if (err.message?.includes('expired')) {
          errorCode = 'EXPIRED_STATE';
        } else if (err.message?.includes('Invalid') || err.message?.includes('state')) {
          errorCode = 'INVALID_STATE';
        } else if (err.message?.includes('exchange')) {
          errorCode = 'TOKEN_EXCHANGE_FAILED';
        }

        const failureUrl = `${frontendBase}?tab=connections&status=error&code=${encodeURIComponent(errorCode)}`;

        const acceptHeader = request.headers['accept'] || '';
        if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
          return reply.status(400).send({
            error: {
              code: errorCode,
              message: 'OAuth callback processing failed',
            },
          });
        }

        return reply.redirect(failureUrl);
      }
    }
  );
};

export default oauthRoutes;
