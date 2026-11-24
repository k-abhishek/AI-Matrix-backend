import prisma from '../../lib/prisma';
import { CrawlRun, PageStatus } from '@prisma/client';
import { FindRunsOptions, FindPagesOptions } from '../../types';

export class CrawlRunRepository {
  async findMany(options: FindRunsOptions = {}): Promise<{ runs: CrawlRun[]; total: number }> {
    const { crawlerId, skip = 0, take = 20 } = options;
    const where = crawlerId ? { crawlerId } : {};

    const [runs, total] = await Promise.all([
      prisma.crawlRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.crawlRun.count({ where }),
    ]);

    return { runs, total };
  }

  async findById(id: string): Promise<CrawlRun | null> {
    return prisma.crawlRun.findUnique({
      where: { id },
      include: {
        crawler: {
          select: {
            id: true,
            name: true,
            sitemapUrl: true,
            baseUrl: true,
          },
        },
      },
    });
  }

  async getRecentErrors(crawlRunId: string, limit = 10) {
    return prisma.crawlRunPage.findMany({
      where: {
        crawlRunId,
        status: PageStatus.FAILED,
      },
      select: {
        url: true,
        errorMessage: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
  }

  async findPages(options: FindPagesOptions) {
    const { crawlRunId, status, skip = 0, take = 50 } = options;
    const where = {
      crawlRunId,
      ...(status && { status }),
    };

    const [pages, total] = await Promise.all([
      prisma.crawlRunPage.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      prisma.crawlRunPage.count({ where }),
    ]);

    return { pages, total };
  }
}

export const crawlRunRepository = new CrawlRunRepository();
export default crawlRunRepository;
export { FindRunsOptions, FindPagesOptions };
