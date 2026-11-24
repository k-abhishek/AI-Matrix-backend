import { FastifyPluginAsync } from 'fastify';
import crawlRunController from '../modules/crawl-runs/crawl-run.controller';
import { requireAuth } from '../middleware/auth';

const errorResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  },
};

const crawlRunProperties = {
  id: { type: 'string', format: 'uuid' },
  crawlerId: { type: 'string', format: 'uuid' },
  status: {
    type: 'string',
    enum: [
      'PENDING',
      'RUNNING',
      'COMPLETED',
      'PARTIALLY_COMPLETED',
      'FAILED',
      'CANCELLED',
      'INTERRUPTED',
    ],
  },
  totalPages: { type: 'integer' },
  discoveredPages: { type: 'integer' },
  queuedPages: { type: 'integer' },
  processingPages: { type: 'integer' },
  fetchedPages: { type: 'integer' },
  cleanedPages: { type: 'integer' },
  skippedPages: { type: 'integer' },
  failedPages: { type: 'integer' },
  totalChunks: { type: 'integer' },
  embeddedChunks: { type: 'integer' },
  storedChunks: { type: 'integer' },
  storageUsedBytes: { type: 'number' },
  averageFetchTimeMs: { type: 'number' },
  errorMessage: { type: ['string', 'null'] },
  startedAt: { type: ['string', 'null'], format: 'date-time' },
  completedAt: { type: ['string', 'null'], format: 'date-time' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

const runIdParamSchema = {
  type: 'object',
  required: ['runId'],
  properties: {
    runId: { type: 'string', format: 'uuid', description: 'Crawl run UUID' },
  },
};

/**
 * Fastify routes plugin for Crawl Run Monitoring & Progress Polling.
 *
 * Base Prefix: /api/crawl-runs
 */
const crawlRunRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  /**
   * GET /api/crawl-runs
   * Retrieve a paginated list of crawl runs, optionally filtered by crawler ID.
   */
  fastify.get(
    '/',
    {
      schema: {
        tags: ['Crawl Runs'],
        summary: 'List crawl runs',
        description: 'Retrieves a paginated list of crawl runs, optionally filtered by crawlerId.',
        querystring: {
          type: 'object',
          properties: {
            crawlerId: {
              type: 'string',
              format: 'uuid',
              description: 'Filter runs for a specific crawler',
            },
            page: { type: 'integer', minimum: 1, default: 1, description: 'Page number' },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 20,
              description: 'Items per page',
            },
          },
        },
        response: {
          200: {
            description: 'Paginated list of crawl runs',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  runs: {
                    type: 'array',
                    items: { type: 'object', properties: crawlRunProperties },
                  },
                  pagination: {
                    type: 'object',
                    properties: {
                      total: { type: 'integer' },
                      page: { type: 'integer' },
                      limit: { type: 'integer' },
                      totalPages: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    (req, reply) => crawlRunController.getAll(req as any, reply)
  );

  /**
   * GET /api/crawl-runs/:runId
   * Retrieve detailed metadata for a single crawl run by its UUID.
   */
  fastify.get(
    '/:runId',
    {
      schema: {
        tags: ['Crawl Runs'],
        summary: 'Get crawl run details',
        description:
          'Retrieves detailed information for a single crawl run including parent crawler metadata.',
        params: runIdParamSchema,
        response: {
          200: {
            description: 'Crawl run details',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  ...crawlRunProperties,
                  crawler: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      sitemapUrl: { type: 'string' },
                      baseUrl: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Crawl run not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlRunController.getById(req as any, reply)
  );

  /**
   * GET /api/crawl-runs/:runId/progress
   * Primary polling endpoint for frontends to track live crawl progress.
   */
  fastify.get(
    '/:runId/progress',
    {
      schema: {
        tags: ['Crawl Runs'],
        summary: 'Get live crawl progress',
        description:
          'Real-time polling endpoint returning progress percentages, stage counters, storage metrics, and recent errors.',
        params: runIdParamSchema,
        response: {
          200: {
            description: 'Crawl run progress summary',
            type: 'object',
            properties: {
              crawlRunId: { type: 'string', format: 'uuid' },
              crawlerId: { type: 'string', format: 'uuid' },
              status: { type: 'string' },
              progressPercentage: { type: 'number', minimum: 0, maximum: 100 },
              progress: {
                type: 'object',
                properties: {
                  totalPages: { type: 'integer' },
                  discoveredPages: { type: 'integer' },
                  queuedPages: { type: 'integer' },
                  processingPages: { type: 'integer' },
                  fetchedPages: { type: 'integer' },
                  cleanedPages: { type: 'integer' },
                  skippedPages: { type: 'integer' },
                  failedPages: { type: 'integer' },
                  totalChunks: { type: 'integer' },
                  embeddedChunks: { type: 'integer' },
                  storedChunks: { type: 'integer' },
                },
              },
              metrics: {
                type: 'object',
                properties: {
                  averageFetchTimeMs: { type: 'number' },
                  totalFetchedBytes: { type: 'number' },
                  storageUsedBytes: { type: 'number' },
                  storageBudgetBytes: { type: 'number' },
                  storageUsagePercentage: { type: 'number' },
                  storageUsageSource: { type: 'string', enum: ['ESTIMATED', 'QDRANT_REPORTED'] },
                },
              },
              timestamps: {
                type: 'object',
                properties: {
                  createdAt: { type: 'string', format: 'date-time' },
                  startedAt: { type: ['string', 'null'], format: 'date-time' },
                  completedAt: { type: ['string', 'null'], format: 'date-time' },
                },
              },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    error: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          404: {
            description: 'Crawl run not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlRunController.getProgress(req as any, reply)
  );

  /**
   * GET /api/crawl-runs/:runId/pages
   * Retrieve paginated page-level crawl results and error audit logs.
   */
  fastify.get(
    '/:runId/pages',
    {
      schema: {
        tags: ['Crawl Runs'],
        summary: 'Get crawled pages for run',
        description: 'Retrieves page-level crawl logs and HTTP statuses for a specific crawl run.',
        params: runIdParamSchema,
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: [
                'DISCOVERED',
                'QUEUED',
                'PROCESSING',
                'FETCHED',
                'SKIPPED',
                'FAILED',
                'COMPLETED',
              ],
              description: 'Filter pages by status',
            },
            page: { type: 'integer', minimum: 1, default: 1, description: 'Page number' },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50,
              description: 'Items per page',
            },
          },
        },
        response: {
          200: {
            description: 'Paginated page results',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  pages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        crawlRunId: { type: 'string', format: 'uuid' },
                        url: { type: 'string' },
                        status: { type: 'string' },
                        httpStatus: { type: ['integer', 'null'] },
                        fetchDurationMs: { type: ['integer', 'null'] },
                        contentBytes: { type: 'integer' },
                        chunksCount: { type: 'integer' },
                        errorMessage: { type: ['string', 'null'] },
                        processedAt: { type: ['string', 'null'], format: 'date-time' },
                        createdAt: { type: 'string', format: 'date-time' },
                        updatedAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                  total: { type: 'integer' },
                },
              },
            },
          },
          404: {
            description: 'Crawl run not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlRunController.getPages(req as any, reply)
  );
};

export default crawlRunRoutes;
