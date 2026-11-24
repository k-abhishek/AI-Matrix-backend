import { FastifyPluginAsync } from 'fastify';
import brandfetchService from '../services/brandfetch.service';

/**
 * Fastify routes plugin for Brandfetch Brand Data.
 * Base prefix: /api/brands
 */
const brandRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/brands/domain/:domain
   * Retrieves full brand data (colors, fonts, company info) server-side via Brand API.
   * Free test domain: brandfetch.com
   */
  fastify.get<{ Params: { domain: string } }>(
    '/domain/:domain',
    {
      schema: {
        tags: ['Brands'],
        summary: 'Retrieve company brand data by domain',
        description: 'Server-side integration calling Brandfetch Brand API with Bearer token.',
        params: {
          type: 'object',
          required: ['domain'],
          properties: {
            domain: { type: 'string', description: 'Domain name, e.g. brandfetch.com or slack.com' },
          },
        },
      },
    },
    async (request, reply) => {
      const { domain } = request.params;
      const result = await brandfetchService.getBrandByDomain(domain);

      if (!result.success) {
        const statusCode =
          result.code === 'brand_not_found' ||
          result.code === 'domain_unresolvable' ||
          result.code === 'domain_invalid'
            ? 404
            : result.code === 'quota_exceeded'
            ? 429
            : result.code === 'api_key_missing'
            ? 503
            : 400;

        return reply.status(statusCode).send({
          success: false,
          code: result.code,
          message: result.error,
        });
      }

      return reply.send({
        success: true,
        data: result.data,
      });
    }
  );
};

export default brandRoutes;
