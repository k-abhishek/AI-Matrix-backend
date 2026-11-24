import { FastifyReply, FastifyRequest } from 'fastify';
import crawlRunService from './crawl-run.service';
import { PageStatus } from '@prisma/client';

export class CrawlRunController {
  async getAll(
    req: FastifyRequest<{
      Querystring: { crawlerId?: string; page?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) {
    const { crawlerId, page, limit } = req.query;
    const result = await crawlRunService.listRuns({
      crawlerId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return reply.status(200).send({
      success: true,
      data: result,
    });
  }

  async getById(req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) {
    const { runId } = req.params;
    const run = await crawlRunService.getRunById(runId);
    return reply.status(200).send({
      success: true,
      data: run,
    });
  }

  async getProgress(req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) {
    const { runId } = req.params;
    const progress = await crawlRunService.getRunProgress(runId);
    return reply.status(200).send(progress);
  }

  async getPages(
    req: FastifyRequest<{
      Params: { runId: string };
      Querystring: { status?: PageStatus; page?: string; limit?: string };
    }>,
    reply: FastifyReply
  ) {
    const { runId } = req.params;
    const { status, page, limit } = req.query;

    const result = await crawlRunService.getRunPages({
      runId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return reply.status(200).send({
      success: true,
      data: result,
    });
  }
}

export const crawlRunController = new CrawlRunController();
export default crawlRunController;

