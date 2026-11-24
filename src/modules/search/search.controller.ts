import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import searchService, { SearchService } from './search.service';

export const searchBodySchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'Search query cannot be empty')
    .max(500, 'Search query exceeds maximum length of 500 characters'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export class SearchController {
  constructor(private service: SearchService = searchService) {}

  /**
   * POST /api/search
   */
  async search(req: FastifyRequest, reply: FastifyReply) {
    const parsed = searchBodySchema.parse(req.body);
    const result = await this.service.search(parsed);
    return reply.status(200).send({
      success: true,
      data: result,
    });
  }
}

export const searchController = new SearchController();
export default searchController;
