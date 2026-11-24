import { FastifyPluginAsync } from 'fastify';
import connectionController from '../modules/connections/connection.controller';
import { requireAuth } from '../middleware/auth';

const connectionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    workspaceId: { type: 'string' },
    userId: { type: 'string' },
    connectorDefinitionId: { type: 'string' },
    connectorKey: { type: 'string' },
    name: { type: 'string' },
    status: {
      type: 'string',
      enum: ['INITIALIZING', 'CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED', 'REVOKED'],
    },
    authType: {
      type: 'string',
      enum: [
        'NONE',
        'API_KEY',
        'BEARER_TOKEN',
        'BASIC_AUTH',
        'OAUTH2_AUTHORIZATION_CODE',
        'OAUTH2_CLIENT_CREDENTIALS',
        'CUSTOM_HEADERS',
      ],
    },
    baseUrl: { type: 'string', nullable: true },
    mcpTransport: { type: 'string', nullable: true },
    config: { type: 'object', additionalProperties: true, nullable: true },
    hasCredentials: { type: 'boolean' },
    lastConnectedAt: { type: 'string', format: 'date-time', nullable: true },
    lastTestedAt: { type: 'string', format: 'date-time', nullable: true },
    lastErrorMessage: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    toolsCount: { type: 'integer' },
  },
};

/**
 * Fastify routes plugin for Workspace Connection Management.
 *
 * Base Prefix: /api/connections
 */
const connectionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  /**
   * POST /api/connections
   * Creates a new connection instance for the current user/workspace.
   */
  fastify.post(
    '/',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Create a new connection',
        description: 'Creates a tenant connection to a Native, MCP, or Custom REST connector.',
        body: {
          type: 'object',
          required: ['name', 'authType'],
          properties: {
            connectorDefinitionId: { type: 'string', format: 'uuid' },
            connectorKey: { type: 'string' },
            name: { type: 'string', minLength: 1 },
            authType: {
              type: 'string',
              enum: [
                'NONE',
                'API_KEY',
                'BEARER_TOKEN',
                'BASIC_AUTH',
                'OAUTH2_AUTHORIZATION_CODE',
                'OAUTH2_CLIENT_CREDENTIALS',
                'CUSTOM_HEADERS',
              ],
            },
            baseUrl: { type: 'string', format: 'uri' },
            mcpTransport: { type: 'string', enum: ['STREAMABLE_HTTP', 'STDIO_ISOLATED'] },
            config: { type: 'object', additionalProperties: true },
            credentials: { type: 'object', additionalProperties: true },
          },
        },
        response: {
          201: {
            description: 'Connection created successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: connectionResponseSchema,
            },
          },
        },
      },
    },
    connectionController.create.bind(connectionController)
  );

  /**
   * GET /api/connections
   * Lists all connections in the caller's workspace.
   */
  fastify.get(
    '/',
    {
      schema: {
        tags: ['Connections'],
        summary: 'List workspace connections',
        description: 'Retrieves all active connections belonging to the authenticated workspace.',
        response: {
          200: {
            description: 'List of connections',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'array',
                items: connectionResponseSchema,
              },
            },
          },
        },
      },
    },
    connectionController.list.bind(connectionController)
  );

  /**
   * GET /api/connections/:id
   * Retrieves details of a specific connection.
   */
  fastify.get(
    '/:id',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Get connection by ID',
        description: 'Retrieves a single connection by ID with tool counts and diagnostic status.',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            description: 'Connection details',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: connectionResponseSchema,
            },
          },
          404: {
            description: 'Connection not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    connectionController.getById.bind(connectionController)
  );

  /**
   * PATCH /api/connections/:id
   * Updates an existing connection.
   */
  fastify.patch(
    '/:id',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Update connection',
        description: 'Updates configuration, name, or credentials for an existing connection.',
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
            name: { type: 'string' },
            baseUrl: { type: 'string', format: 'uri' },
            mcpTransport: { type: 'string', enum: ['STREAMABLE_HTTP', 'STDIO_ISOLATED'] },
            config: { type: 'object', additionalProperties: true },
            status: {
              type: 'string',
              enum: ['INITIALIZING', 'CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED', 'REVOKED'],
            },
            credentials: { type: 'object', additionalProperties: true },
          },
        },
        response: {
          200: {
            description: 'Updated connection',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: connectionResponseSchema,
            },
          },
        },
      },
    },
    connectionController.update.bind(connectionController)
  );

  /**
   * DELETE /api/connections/:id
   * Deletes a connection and its associated credentials.
   */
  fastify.delete(
    '/:id',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Delete connection',
        description: 'Permanently deletes a connection, credentials, and tool mappings.',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            description: 'Deletion confirmation',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string' },
              id: { type: 'string' },
            },
          },
        },
      },
    },
    connectionController.delete.bind(connectionController)
  );

  /**
   * POST /api/connections/:id/discover
   * Triggers full tool, resource, and prompt discovery on an active connection.
   */
  fastify.post(
    '/:id/discover',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Discover connection tools, resources, and prompts',
        description: 'Queries remote MCP server for capabilities and synchronizes them to PostgreSQL.',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    connectionController.discover.bind(connectionController)
  );

  /**
   * GET /api/connections/:id/tools
   * Lists all discovered tools for a connection.
   */
  fastify.get(
    '/:id/tools',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Get discovered tools for connection',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
    connectionController.getTools.bind(connectionController)
  );

  /**
   * GET /api/connections/:id/resources
   * Lists all discovered resources for a connection.
   */
  fastify.get(
    '/:id/resources',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Get discovered resources for connection',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
    connectionController.getResources.bind(connectionController)
  );

  /**
   * GET /api/connections/:id/prompts
   * Lists all discovered prompt templates for a connection.
   */
  fastify.get(
    '/:id/prompts',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Get discovered prompts for connection',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
          },
        },
      },
    },
    connectionController.getPrompts.bind(connectionController)
  );

  /**
   * POST /api/connections/:id/test
   * Runs diagnostic health check and ping against the connection.
   */
  fastify.post(
    '/:id/test',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Test connection health',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    connectionController.test.bind(connectionController)
  );

  /**
   * POST /api/connections/:id/execute
   * Executes a specific tool on the connection.
   */
  fastify.post(
    '/:id/execute',
    {
      schema: {
        tags: ['Connections'],
        summary: 'Execute a tool on connection',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['toolName'],
          properties: {
            toolName: { type: 'string' },
            parameters: { type: 'object', additionalProperties: true },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    connectionController.execute.bind(connectionController)
  );
};

export default connectionRoutes;
