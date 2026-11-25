import { FastifyPluginAsync } from 'fastify';
import healthRoutes from './healthRoutes';
import crawlerRoutes from './crawlerRoutes';
import crawlRunRoutes from './crawlRunRoutes';
import chatRoutes from './chatRoutes';
import searchRoutes from './searchRoutes';
import connectorRoutes from './connectorRoutes';
import connectionRoutes from './connectionRoutes';
import mcpRoutes from './mcpRoutes';
import oauthRoutes from './oauthRoutes';
import agentRoutes from './agentRoutes';
import agentBindingRoutes from './agentBindingRoutes';
import knowledgeRoutes from './knowledgeRoutes';
import skillRoutes from './skillRoutes';
import brandRoutes from './brandRoutes';

const apiRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/',
    {
      schema: {
        tags: ['General'],
        summary: 'API welcome endpoint',
        description: 'Returns API status and documentation entry point.',
        response: {
          200: {
            description: 'API information',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              documentation: { type: 'string' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.status(200).send({
        success: true,
        message: 'Website Crawler & Vector Indexer Backend API',
        documentation: '/documentation',
      });
    }
  );

  await fastify.register(healthRoutes, { prefix: '/health' });

  fastify.get(
    '/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Readiness check redirect',
        description: 'Convenience alias redirecting directly to /api/health/ready',
        response: {
          302: {
            description: 'Redirect to /api/health/ready',
            type: 'null',
          },
        },
      },
    },
    async (_req, reply) => {
      return reply.redirect('/api/health/ready');
    }
  );

  await fastify.register(crawlerRoutes, { prefix: '/crawlers' });
  await fastify.register(crawlRunRoutes, { prefix: '/crawl-runs' });
  await fastify.register(chatRoutes, { prefix: '/chat' });
  await fastify.register(searchRoutes, { prefix: '/search' });
  await fastify.register(connectorRoutes, { prefix: '/connectors' });
  await fastify.register(connectionRoutes, { prefix: '/connections' });
  await fastify.register(mcpRoutes, { prefix: '/mcp' });
  await fastify.register(oauthRoutes);
  await fastify.register(agentRoutes, { prefix: '/agents' });
  await fastify.register(agentBindingRoutes, { prefix: '/agents' });
  await fastify.register(knowledgeRoutes, { prefix: '/knowledge-bases' });
  await fastify.register(skillRoutes, { prefix: '/skills' });
  await fastify.register(brandRoutes, { prefix: '/brands' });
};

export default apiRoutes;
