import prisma from '../../lib/prisma';
import { Crawler, Prisma } from '@prisma/client';

export class CrawlerRepository {
  async create(data: Prisma.CrawlerCreateInput): Promise<Crawler> {
    return prisma.crawler.create({ data });
  }

  async findAll(): Promise<Crawler[]> {
    return prisma.crawler.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<Crawler | null> {
    return prisma.crawler.findUnique({
      where: { id },
      include: {
        _count: {
          select: { crawlRuns: true, crawledPages: true },
        },
      },
    });
  }

  async update(id: string, data: Prisma.CrawlerUpdateInput): Promise<Crawler> {
    return prisma.crawler.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<Crawler> {
    return prisma.crawler.delete({
      where: { id },
    });
  }

  async getCrawlerMetrics(crawlerId: string) {
    const pageCounts = await prisma.crawledPage.groupBy({
      by: ['status'],
      where: { crawlerId },
      _count: { _all: true },
      _sum: { contentBytes: true, chunksCount: true },
    });

    const totalPages = await prisma.crawledPage.count({ where: { crawlerId } });
    const totalRuns = await prisma.crawlRun.count({ where: { crawlerId } });
    const lastRun = await prisma.crawlRun.findFirst({
      where: { crawlerId },
      orderBy: { createdAt: 'desc' },
    });

    const totalBytes = pageCounts.reduce((acc, curr) => acc + (curr._sum.contentBytes || 0), 0);
    const totalChunks = pageCounts.reduce((acc, curr) => acc + (curr._sum.chunksCount || 0), 0);

    return {
      crawlerId,
      totalPages,
      totalChunks,
      totalBytes,
      totalRuns,
      lastRunStatus: lastRun?.status || null,
      lastCrawledAt: lastRun?.completedAt || null,
      pageBreakdown: pageCounts.map((p) => ({
        status: p.status,
        count: p._count._all,
      })),
    };
  }
}

export const crawlerRepository = new CrawlerRepository();
export default crawlerRepository;

