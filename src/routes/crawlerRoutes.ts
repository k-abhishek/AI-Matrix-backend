import { FastifyPluginAsync } from 'fastify';
import crawlerController from '../modules/crawlers/crawler.controller';
import { requireAuth } from '../middleware/auth';

const errorResponseSchema = {
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
};

const crawlerProperties = {
  id: { type: 'string', format: 'uuid' },
  name: { type: 'string' },
  sitemapUrl: { type: 'string' },
  baseUrl: { type: 'string' },
  allowedHosts: { type: 'array', items: { type: 'string' } },
  includePatterns: { type: 'array', items: { type: 'string' } },
  excludePatterns: { type: 'array', items: { type: 'string' } },
  settings: {
    type: 'object',
    properties: {
      maxPages: { type: 'integer' },
      maxConcurrency: { type: 'integer' },
      requestTimeoutMs: { type: 'integer' },
      requestDelayMs: { type: 'integer' },
    },
  },
  enabled: { type: 'boolean' },
  isRunning: { type: 'boolean' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
};

const idParamSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid', description: 'Crawler UUID' },
  },
};

/**
 * Fastify routes plugin for Crawler Management & Operations.
 *
 * Base Prefix: /api/crawlers
 */
const crawlerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAuth);
  /**
   * POST /api/crawlers
   * Register a new website crawler configuration.
   */
  fastify.post(
    '/',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Register a new website crawler',
        description: 'Creates a crawler configuration and stores it in PostgreSQL via Prisma.',
        body: {
          type: 'object',
          required: ['name', 'sitemapUrl'],
          properties: {
            name: { type: 'string', minLength: 1, description: 'Descriptive crawler name' },
            sitemapUrl: { type: 'string', description: 'Full URL to the target sitemap.xml' },
            baseUrl: { type: 'string', description: 'Optional crawl origin override' },
            allowedHosts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Hostnames permitted to crawl',
            },
            includePatterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Regex/glob patterns to include',
            },
            excludePatterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Regex/glob patterns to exclude',
            },
            maxPages: { type: 'integer', minimum: 1, maximum: 10000, default: 1000 },
            maxConcurrency: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
            requestTimeoutMs: { type: 'integer', minimum: 1000, maximum: 60000, default: 15000 },
            requestDelayMs: { type: 'integer', minimum: 0, maximum: 10000, default: 500 },
            enabled: { type: 'boolean', default: true },
          },
        },
        response: {
          201: {
            description: 'Crawler created successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'object', properties: crawlerProperties },
            },
          },
          400: {
            description: 'Validation failed',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.create(req, reply)
  );

  /**
   * GET /api/crawlers
   * Retrieve all registered website crawler configurations.
   */
  fastify.get(
    '/',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'List all website crawlers',
        description: 'Retrieves all registered website crawlers ordered by creation date descending.',
        response: {
          200: {
            description: 'List of crawlers',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'array',
                items: { type: 'object', properties: crawlerProperties },
              },
            },
          },
        },
      },
    },
    (req, reply) => crawlerController.getAll(req, reply)
  );

  /**
   * GET /api/crawlers/:id
   * Retrieve a specific crawler configuration by its UUID.
   */
  fastify.get(
    '/:id',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Get crawler by ID',
        description: 'Retrieves a single crawler record by UUID with crawl run and page counts.',
        params: idParamSchema,
        response: {
          200: {
            description: 'Crawler record',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  ...crawlerProperties,
                  _count: {
                    type: 'object',
                    properties: {
                      crawlRuns: { type: 'integer' },
                      crawledPages: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Crawler not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.getById(req as any, reply)
  );

  /**
   * PATCH /api/crawlers/:id
   * Update configuration fields of an existing crawler.
   */
  fastify.patch(
    '/:id',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Update crawler configuration',
        description:
          'Updates configuration fields of an existing crawler. Blocked if a crawl is actively running.',
        params: idParamSchema,
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            sitemapUrl: { type: 'string' },
            baseUrl: { type: 'string' },
            allowedHosts: { type: 'array', items: { type: 'string' } },
            includePatterns: { type: 'array', items: { type: 'string' } },
            excludePatterns: { type: 'array', items: { type: 'string' } },
            maxPages: { type: 'integer', minimum: 1, maximum: 10000 },
            maxConcurrency: { type: 'integer', minimum: 1, maximum: 10 },
            requestTimeoutMs: { type: 'integer', minimum: 1000, maximum: 60000 },
            requestDelayMs: { type: 'integer', minimum: 0, maximum: 10000 },
            enabled: { type: 'boolean' },
          },
        },
        response: {
          200: {
            description: 'Updated crawler record',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: { type: 'object', properties: crawlerProperties },
            },
          },
          400: {
            description: 'Invalid update request or crawl actively running',
            ...errorResponseSchema,
          },
          404: {
            description: 'Crawler not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.update(req as any, reply)
  );

  /**
   * DELETE /api/crawlers/:id
   * Delete a crawler configuration and cleanup vectors.
   */
  fastify.delete(
    '/:id',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Delete crawler configuration',
        description:
          'Deletes a crawler configuration, its associated PostgreSQL records, and all Qdrant vectors.',
        params: idParamSchema,
        response: {
          200: {
            description: 'Deletion confirmation',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'Crawler not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.delete(req as any, reply)
  );

  // ---------------------------------------------------------------------------
  // Crawl Execution Operations
  // ---------------------------------------------------------------------------

  /**
   * POST /api/crawlers/:id/crawl
   * Manually triggers an incremental in-process crawl.
   */
  fastify.post(
    '/:id/crawl',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Trigger incremental crawl',
        description:
          'Starts an asynchronous in-process incremental crawl. Uses content hashes to skip unchanged pages.',
        params: idParamSchema,
        response: {
          202: {
            description: 'Crawl accepted and running asynchronously',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Crawl started' },
              crawlRunId: { type: 'string', format: 'uuid' },
              status: { type: 'string', example: 'RUNNING' },
            },
          },
          400: {
            description: 'Crawler is disabled or already running',
            ...errorResponseSchema,
          },
          404: {
            description: 'Crawler not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.triggerCrawl(req as any, reply)
  );

  /**
   * POST /api/crawlers/:id/crawl/full
   * Triggers a full in-process crawl (bypasses content hash comparison).
   */
  fastify.post(
    '/:id/crawl/full',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Trigger full crawl',
        description:
          'Starts an asynchronous full crawl, forcing re-extraction, re-chunking, and re-embedding of all pages.',
        params: idParamSchema,
        response: {
          202: {
            description: 'Full crawl accepted and running asynchronously',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Full crawl started' },
              crawlRunId: { type: 'string', format: 'uuid' },
              status: { type: 'string', example: 'RUNNING' },
            },
          },
          400: {
            description: 'Crawler is disabled or already running',
            ...errorResponseSchema,
          },
          404: {
            description: 'Crawler not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.triggerFullCrawl(req as any, reply)
  );

  /**
   * POST /api/crawlers/:id/cancel
   * Cooperatively cancels an active in-flight crawl.
   */
  fastify.post(
    '/:id/cancel',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Cancel active crawl',
        description:
          'Cooperatively aborts an active in-flight crawl and sets its run status to CANCELLED.',
        params: idParamSchema,
        response: {
          200: {
            description: 'Cancellation confirmation',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'Crawler not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.cancelCrawl(req as any, reply)
  );

  // ---------------------------------------------------------------------------
  // Metrics & Storage Monitoring
  // ---------------------------------------------------------------------------

  /**
   * GET /api/crawlers/:crawlerId/metrics
   * Retrieves aggregated crawler statistics and Qdrant storage usage.
   */
  fastify.get(
    '/:crawlerId/metrics',
    {
      schema: {
        tags: ['Crawlers'],
        summary: 'Get crawler metrics & storage usage',
        description:
          'Retrieves total crawled pages, chunk count, bytes processed, status breakdown, and Qdrant storage budget.',
        params: {
          type: 'object',
          required: ['crawlerId'],
          properties: {
            crawlerId: { type: 'string', format: 'uuid', description: 'Crawler UUID' },
          },
        },
        response: {
          200: {
            description: 'Crawler metrics and storage usage',
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              data: {
                type: 'object',
                properties: {
                  crawlerId: { type: 'string', format: 'uuid' },
                  totalPages: { type: 'integer' },
                  totalChunks: { type: 'integer' },
                  totalBytes: { type: 'integer' },
                  totalRuns: { type: 'integer' },
                  lastRunStatus: { type: ['string', 'null'] },
                  lastCrawledAt: { type: ['string', 'null'], format: 'date-time' },
                  pageBreakdown: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        status: { type: 'string' },
                        count: { type: 'integer' },
                      },
                    },
                  },
                  storage: {
                    type: 'object',
                    properties: {
                      storageUsedBytes: { type: 'number' },
                      storageBudgetBytes: { type: 'number' },
                      usagePercentage: { type: 'number' },
                      isThresholdReached: { type: 'boolean' },
                      source: { type: 'string', enum: ['ESTIMATED', 'QDRANT_REPORTED'] },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Crawler not found',
            ...errorResponseSchema,
          },
        },
      },
    },
    (req, reply) => crawlerController.getMetrics(req as any, reply)
  );
};

export default crawlerRoutes;
