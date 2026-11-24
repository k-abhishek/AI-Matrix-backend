import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import crawlerService from './crawler.service';

export const createCrawlerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  sitemapUrl: z.string().url('sitemapUrl must be a valid URL'),
  baseUrl: z.string().url().optional(),
  allowedHosts: z.array(z.string()).optional(),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  maxPages: z.number().int().positive().max(10000).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  requestTimeoutMs: z.number().int().min(1000).max(60000).optional(),
  requestDelayMs: z.number().int().min(0).max(10000).optional(),
  enabled: z.boolean().optional(),
});

export const updateCrawlerSchema = createCrawlerSchema.partial();

export class CrawlerController {
  async create(req: FastifyRequest, reply: FastifyReply) {
    const parsed = createCrawlerSchema.parse(req.body);
    const crawler = await crawlerService.createCrawler(parsed);
    return reply.status(201).send({
      success: true,
      data: crawler,
    });
  }

  async getAll(_req: FastifyRequest, reply: FastifyReply) {
    const crawlers = await crawlerService.getAllCrawlers();
    return reply.status(200).send({
      success: true,
      data: crawlers,
    });
  }

  async getById(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const crawler = await crawlerService.getCrawlerById(id);
    return reply.status(200).send({
      success: true,
      data: crawler,
    });
  }

  async update(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const parsed = updateCrawlerSchema.parse(req.body);
    const crawler = await crawlerService.updateCrawler(id, parsed);
    return reply.status(200).send({
      success: true,
      data: crawler,
    });
  }

  async delete(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const result = await crawlerService.deleteCrawler(id);
    return reply.status(200).send(result);
  }

  async triggerCrawl(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const { crawlRunId } = await crawlerService.triggerCrawl(id, false);
    return reply.status(202).send({
      success: true,
      message: 'Crawl started',
      crawlRunId,
      status: 'RUNNING',
    });
  }

  async triggerFullCrawl(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const { crawlRunId } = await crawlerService.triggerCrawl(id, true);
    return reply.status(202).send({
      success: true,
      message: 'Full crawl started',
      crawlRunId,
      status: 'RUNNING',
    });
  }

  async cancelCrawl(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    const result = await crawlerService.cancelCrawl(id);
    return reply.status(200).send(result);
  }

  async getMetrics(req: FastifyRequest<{ Params: { crawlerId: string } }>, reply: FastifyReply) {
    const { crawlerId } = req.params;
    const metrics = await crawlerService.getCrawlerMetrics(crawlerId);
    return reply.status(200).send({
      success: true,
      data: metrics,
    });
  }
}

export const crawlerController = new CrawlerController();
export default crawlerController;

