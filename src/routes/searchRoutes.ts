import { FastifyPluginAsync } from 'fastify';
import searchController from '../modules/search/search.controller';
import { requireAuth } from '../middleware/auth';

/**
 * Fastify routes plugin for Semantic Vector Search.
 *
 * Base Prefix: /api/search
 *
 * Responsibilities:
 * - Natural-language semantic search across crawled & indexed content in Qdrant.
 * - Enforces minimum relevance score threshold (0.5) by default.
 * - Top-K candidate pagination.
 */
const searchRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  /**
   * POST /api/search
   * Execute a semantic vector similarity search via JSON payload.
   */
  fastify.post(
    '/',
    {
      schema: {
        description: 'Perform semantic vector similarity search against crawled website content in Qdrant',
        tags: ['Search'],
        summary: 'Semantic search',
        body: {
          type: 'object',
          required: ['query'],
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query',
              minLength: 1,
              maxLength: 500,
            },
            limit: {
              type: 'integer',
              description: 'Number of results to return (1-100)',
              default: 10,
              minimum: 1,
              maximum: 100,
            },
            page: {
              type: 'integer',
              description: 'Page number for pagination',
              default: 1,
              minimum: 1,
            },
            collectionName: {
              type: 'string',
              description: 'Optional Qdrant collection name to scope the search to',
            },
            crawlerName: {
              type: 'string',
              description: 'Optional crawler name to scope the search to',
            },
          },
        },
        response: {
          200: {
            description: 'Search query results',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  total: { type: 'integer' },
                  page: { type: 'integer' },
                  limit: { type: 'integer' },
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        score: { type: 'number' },
                        content: { type: 'string' },
                        metadata: {
                          type: 'object',
                          properties: {
                            crawlerId: { type: 'string' },
                            pageId: { type: 'string' },
                            url: { type: 'string' },
                            title: { type: 'string' },
                            chunkIndex: { type: 'integer' },
                            contentHash: { type: 'string' },
                            crawledAt: { type: 'string' },
                          },
                          additionalProperties: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid search parameters or validation error',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string' },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          500: {
            description: 'Internal server or vector store error',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    (req, reply) => searchController.search(req, reply)
  );
};

export default searchRoutes;
