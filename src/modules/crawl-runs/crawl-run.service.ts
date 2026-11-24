import crawlRunRepository, { CrawlRunRepository } from './crawl-run.repository';
import { NotFoundError } from '../../lib/errors';
import { calculateProgressPercentage } from '../../utils/progress';
import storageService from '../../services/storage.service';
import { PageStatus } from '@prisma/client';
import { ProgressSummary, SerializedCrawlRun } from '../../types';

export class CrawlRunService {
  constructor(private repo: CrawlRunRepository = crawlRunRepository) {}

  async listRuns(options: { crawlerId?: string; page?: number; limit?: number }) {
    const page = options.page || 1;
    const limit = options.limit || 20;
    const skip = (page - 1) * limit;

    const { runs, total } = await this.repo.findMany({
      crawlerId: options.crawlerId,
      skip,
      take: limit,
    });

    const serializedRuns: SerializedCrawlRun[] = runs.map((r) => ({
      ...r,
      storageUsedBytes: Number(r.storageUsedBytes),
    }));

    return {
      runs: serializedRuns,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getRunById(id: string): Promise<SerializedCrawlRun> {
    const run = await this.repo.findById(id);
    if (!run) {
      throw new NotFoundError(`Crawl run with ID '${id}' not found`);
    }

    return {
      ...run,
      storageUsedBytes: Number(run.storageUsedBytes),
    };
  }

  async getRunProgress(id: string): Promise<ProgressSummary> {
    const run = await this.getRunById(id);
    const recentErrors = await this.repo.getRecentErrors(id, 10);
    const storageMetrics = await storageService.getStorageMetrics(Number(run.storageUsedBytes));

    const progressPercentage = calculateProgressPercentage(run);

    return {
      crawlRunId: run.id,
      crawlerId: run.crawlerId,
      status: run.status,
      progressPercentage,
      progress: {
        totalPages: run.totalPages,
        discoveredPages: run.discoveredPages,
        queuedPages: run.queuedPages,
        processingPages: run.processingPages,
        fetchedPages: run.fetchedPages,
        cleanedPages: run.cleanedPages,
        skippedPages: run.skippedPages,
        failedPages: run.failedPages,
        totalChunks: run.totalChunks,
        embeddedChunks: run.embeddedChunks,
        storedChunks: run.storedChunks,
      },
      metrics: {
        averageFetchTimeMs: run.averageFetchTimeMs,
        totalFetchedBytes: Number(run.storageUsedBytes),
        storageUsedBytes: storageMetrics.currentUsageBytes,
        storageBudgetBytes: storageMetrics.totalBudgetBytes,
        storageUsagePercentage: storageMetrics.usagePercentage,
        storageUsageSource: storageMetrics.usageSource,
      },
      timestamps: {
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt ? run.startedAt.toISOString() : null,
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
      },
      errors: recentErrors.map((e) => ({
        url: e.url,
        error: e.errorMessage || 'Unknown error',
        timestamp: e.updatedAt.toISOString(),
      })),
    };
  }

  async getRunPages(options: {
    runId: string;
    status?: PageStatus;
    page?: number;
    limit?: number;
  }) {
    await this.getRunById(options.runId);

    const page = options.page || 1;
    const limit = options.limit || 50;
    const skip = (page - 1) * limit;

    const { pages, total } = await this.repo.findPages({
      crawlRunId: options.runId,
      status: options.status,
      skip,
      take: limit,
    });

    return {
      pages,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const crawlRunService = new CrawlRunService();
export default crawlRunService;
