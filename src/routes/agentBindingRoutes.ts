import { FastifyPluginAsync } from 'fastify';
import agentBindingController from '../modules/agents/agent-binding.controller';
import { requireAuth } from '../middleware/auth';

/**
 * Fastify routes plugin for Agent Connector Bindings.
 * Base Prefix: /api/agents
 */
const agentBindingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);

  /**
   * GET /api/agents/:agentId/connectors
   */
  fastify.get(
    '/:agentId/connectors',
    {
      schema: {
        tags: ['Agents'],
        summary: 'List connector bindings for an agent',
        params: {
          type: 'object',
          required: ['agentId'],
          properties: {
            agentId: { type: 'string' },
          },
        },
      },
    },
    agentBindingController.list.bind(agentBindingController)
  );

  /**
   * POST /api/agents/:agentId/connectors
   */
  fastify.post(
    '/:agentId/connectors',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Bind a connector connection to an agent',
        params: {
          type: 'object',
          required: ['agentId'],
          properties: {
            agentId: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['connectionId'],
          properties: {
            connectionId: { type: 'string', format: 'uuid' },
            allowedToolNames: { type: 'array', items: { type: 'string' } },
            isEnabled: { type: 'boolean', default: true },
          },
        },
      },
    },
    agentBindingController.create.bind(agentBindingController)
  );

  /**
   * PATCH /api/agents/:agentId/connectors/:connectionId
   */
  fastify.patch(
    '/:agentId/connectors/:connectionId',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Update agent connector binding permissions',
        params: {
          type: 'object',
          required: ['agentId', 'connectionId'],
          properties: {
            agentId: { type: 'string' },
            connectionId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          properties: {
            allowedToolNames: { type: 'array', items: { type: 'string' } },
            isEnabled: { type: 'boolean' },
          },
        },
      },
    },
    agentBindingController.update.bind(agentBindingController)
  );

  /**
   * DELETE /api/agents/:agentId/connectors/:connectionId
   */
  fastify.delete(
    '/:agentId/connectors/:connectionId',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Unbind connector connection from agent',
        params: {
          type: 'object',
          required: ['agentId', 'connectionId'],
          properties: {
            agentId: { type: 'string' },
            connectionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    agentBindingController.delete.bind(agentBindingController)
  );
};

export default agentBindingRoutes;
