import { FastifyPluginAsync } from 'fastify';
import connectorController from '../modules/connectors/connector.controller';
import { requireAuth } from '../middleware/auth';

const catalogAuthFieldSchema = {
  type: 'object',
  required: ['name', 'label', 'type', 'required'],
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    type: { type: 'string', enum: ['text', 'password'] },
    placeholder: { type: 'string' },
    helpText: { type: 'string' },
    required: { type: 'boolean' },
  },
};

const connectorDefinitionSchema = {
  type: 'object',
  required: [
    'id',
    'key',
    'name',
    'description',
    'type',
    'supportedAuth',
    'recommendedAuth',
    'oauthAvailable',
    'requiresBaseUrl',
    'authFields',
    'iconKey',
    'isAvailable',
  ],
  properties: {
    id: { type: 'string' },
    key: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    type: { type: 'string', enum: ['NATIVE', 'MCP', 'CUSTOM_REST'] },
    supportedAuth: {
      type: 'array',
      items: { type: 'string' },
    },
    recommendedAuth: { type: 'string' },
    oauthAvailable: { type: 'boolean' },
    requiresBaseUrl: { type: 'boolean' },
    baseUrlLabel: { type: 'string', nullable: true },
    baseUrlPlaceholder: { type: 'string', nullable: true },
    authFields: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: catalogAuthFieldSchema,
      },
    },
    iconKey: { type: 'string' },
    docUrl: { type: 'string', nullable: true },
    isAvailable: { type: 'boolean' },
    isSystem: { type: 'boolean' },
    defaultConfig: { type: 'object', additionalProperties: true, nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

/**
 * Fastify routes plugin for Connector Platform Catalog.
 *
 * Base Prefix: /api/connectors
 */
const connectorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  /**
   * GET /api/connectors/catalog
   * Retrieves all available connector definitions.
   */
  fastify.get(
    '/catalog',
    {
      schema: {
        tags: ['Connectors'],
        summary: 'List connector catalog',
        description: 'Returns available Native, MCP, and Custom REST integration definitions.',
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['NATIVE', 'MCP', 'CUSTOM_REST'] },
            search: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'List of connector definitions',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'array',
                items: connectorDefinitionSchema,
              },
            },
          },
        },
      },
    },
    connectorController.getCatalog.bind(connectorController)
  );

  /**
   * GET /api/connectors/catalog/:key
   * Retrieves a single connector definition by unique key.
   */
  fastify.get(
    '/catalog/:key',
    {
      schema: {
        tags: ['Connectors'],
        summary: 'Get connector definition by key',
        description: 'Returns details and supported authentication methods for a specific connector key.',
        params: {
          type: 'object',
          required: ['key'],
          properties: {
            key: { type: 'string', description: 'Connector definition key (e.g. slack, gmail, mcp-server)' },
          },
        },
        response: {
          200: {
            description: 'Connector definition details',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: connectorDefinitionSchema,
            },
          },
          404: {
            description: 'Connector definition not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    connectorController.getDefinitionByKey.bind(connectorController)
  );
};

export default connectorRoutes;
