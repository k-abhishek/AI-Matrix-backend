import { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../middleware/auth';
import mcpDiscoveryService from '../modules/mcp/mcp-discovery.service';
import mcpClientManager from '../modules/mcp/mcp-client.manager';
import mcpAuthManager from '../modules/mcp/mcp-auth.manager';
import ssrfGuard from '../lib/network/ssrf-guard';
import { McpTransportType, ConnectionAuthType } from '@prisma/client';
import { BadRequestError } from '../lib/errors';

/**
 * Fastify routes plugin for Model Context Protocol (MCP) diagnostics & discovery.
 * Base Prefix: /api/mcp
 */
const mcpRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  /**
   * POST /api/mcp/discover
   * Ephemeral discovery probe. Connects to a remote MCP server URL to inspect
   * advertised capabilities, tools, resources, and prompts without persisting to DB.
   */
  fastify.post(
    '/discover',
    {
      schema: {
        tags: ['MCP'],
        summary: 'Probe and discover remote MCP server capabilities',
        description:
          'Connects to a remote MCP server endpoint to validate protocol handshake and list available tools, resources, and prompts.',
        body: {
          type: 'object',
          required: ['serverUrl'],
          properties: {
            serverUrl: { type: 'string', format: 'uri' },
            transport: {
              type: 'string',
              enum: ['STREAMABLE_HTTP', 'LEGACY_HTTP_SSE'],
              default: 'STREAMABLE_HTTP',
            },
            auth: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['NONE', 'BEARER_TOKEN', 'API_KEY', 'CUSTOM_HEADERS'],
                  default: 'NONE',
                },
                token: { type: 'string' },
                apiKey: { type: 'string' },
                headerName: { type: 'string' },
                headers: { type: 'object', additionalProperties: { type: 'string' } },
              },
            },
          },
        },
        response: {
          200: {
            description: 'Discovered server capabilities and tools',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  isHealthy: { type: 'boolean' },
                  protocolVersion: { type: 'string' },
                  capabilities: {
                    type: 'object',
                    properties: {
                      tools: { type: 'boolean' },
                      resources: { type: 'boolean' },
                      prompts: { type: 'boolean' },
                      logging: { type: 'boolean' },
                    },
                  },
                  tools: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        displayName: { type: 'string' },
                        description: { type: 'string' },
                        inputSchema: { type: 'object', additionalProperties: true },
                        requiresApproval: { type: 'boolean' },
                      },
                    },
                  },
                  resources: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        uri: { type: 'string' },
                        name: { type: 'string' },
                        description: { type: 'string', nullable: true },
                        mimeType: { type: 'string', nullable: true },
                      },
                    },
                  },
                  prompts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        description: { type: 'string', nullable: true },
                      },
                    },
                  },
                  latencyMs: { type: 'number' },
                  testedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        serverUrl: string;
        transport?: McpTransportType;
        auth?: {
          type?: ConnectionAuthType;
          token?: string;
          apiKey?: string;
          headerName?: string;
          headers?: Record<string, string>;
        };
      };

      const serverUrl = body.serverUrl?.trim();
      if (!serverUrl) {
        throw new BadRequestError('serverUrl is required');
      }

      await ssrfGuard.assertSafeUrl(serverUrl);

      const transportType = body.transport || McpTransportType.STREAMABLE_HTTP;
      const authType = body.auth?.type || ConnectionAuthType.NONE;
      const headers = mcpAuthManager.buildHeadersFromDecrypted(authType, body.auth || {});

      const result = await mcpDiscoveryService.probeServer(serverUrl, transportType, headers);
      return reply.send({
        success: true,
        data: result,
      });
    }
  );

  /**
   * POST /api/mcp/test
   * Tests ping responsiveness to an arbitrary MCP server endpoint.
   */
  fastify.post(
    '/test',
    {
      schema: {
        tags: ['MCP'],
        summary: 'Test connectivity to remote MCP server',
        description: 'Performs protocol handshake and ping test against an MCP server URL.',
        body: {
          type: 'object',
          required: ['serverUrl'],
          properties: {
            serverUrl: { type: 'string', format: 'uri' },
            transport: {
              type: 'string',
              enum: ['STREAMABLE_HTTP', 'LEGACY_HTTP_SSE'],
              default: 'STREAMABLE_HTTP',
            },
            headers: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  isHealthy: { type: 'boolean' },
                  latencyMs: { type: 'number' },
                  testedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        serverUrl: string;
        transport?: McpTransportType;
        headers?: Record<string, string>;
      };

      const startTime = Date.now();
      const { client } = await mcpClientManager.createEphemeralClient(
        body.serverUrl,
        body.transport || McpTransportType.STREAMABLE_HTTP,
        body.headers || {}
      );

      try {
        await client.ping();
        const latencyMs = Date.now() - startTime;
        return reply.send({
          success: true,
          data: {
            isHealthy: true,
            latencyMs,
            testedAt: new Date().toISOString(),
          },
        });
      } finally {
        await client.close().catch(() => {});
      }
    }
  );
};

export default mcpRoutes;
