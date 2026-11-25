import prisma from '../lib/prisma';
import logger from '../lib/logger';
import { CrawlRunStatus, PageStatus } from '@prisma/client';
import sitemapService from './sitemap.service';
import fetcherService from './fetcher.service';
import contentExtractorService from './content-extractor.service';
import chunkingService from './chunking.service';
import embeddingService from './embedding.service';
import qdrantService from './qdrant.service';
import storageService from './storage.service';
import { hashContent, sanitizeCollectionName } from '../utils/hashing';
import { StorageBudgetExceededError } from '../lib/errors';
import env from '../config/env';
import { StartCrawlOptions, ChunkItem } from '../types';

export class CrawlService {
  private activeControllers = new Map<string, AbortController>();

  /**
   * Recovers dangling crawl runs on application startup.
   */
  async recoverDanglingRuns(): Promise<void> {
    try {
      const danglingRuns = await prisma.crawlRun.findMany({
        where: { status: CrawlRunStatus.RUNNING },
        select: { id: true, crawlerId: true },
      });

      if (danglingRuns.length > 0) {
        logger.warn(`Recovering ${danglingRuns.length} interrupted crawl runs from previous server session...`);

        await prisma.crawlRun.updateMany({
          where: { status: CrawlRunStatus.RUNNING },
          data: {
            status: CrawlRunStatus.INTERRUPTED,
            errorMessage: 'Process was terminated or server restarted during crawl execution',
            completedAt: new Date(),
          },
        });

        const crawlerIds = [...new Set(danglingRuns.map((r) => r.crawlerId))];
        await prisma.crawler.updateMany({
          where: { id: { in: crawlerIds } },
          data: { isRunning: false },
        });

        logger.info(`Successfully marked dangling crawl runs as INTERRUPTED`);
      }
    } catch (err: any) {
      logger.error(`Error during startup recovery of crawl runs: ${err.message}`);
    }
  }

  /**
   * Cancels an active crawl run cooperatively.
   */
  async cancelCrawl(crawlerId: string): Promise<boolean> {
    const controller = this.activeControllers.get(crawlerId);
    if (!controller) {
      return false;
    }

    logger.info(`Cancelling crawl for crawler ${crawlerId}...`);
    controller.abort();
    this.activeControllers.delete(crawlerId);

    await prisma.crawler.update({
      where: { id: crawlerId },
      data: { isRunning: false },
    });

    await prisma.crawlRun.updateMany({
      where: { crawlerId, status: CrawlRunStatus.RUNNING },
      data: {
        status: CrawlRunStatus.CANCELLED,
        errorMessage: 'Crawl was manually cancelled by user request',
        completedAt: new Date(),
      },
    });

    return true;
  }

  /**
   * Triggers an in-process asynchronous crawl.
   */
  async triggerCrawl(options: StartCrawlOptions): Promise<{ crawlRunId: string }> {
    const { crawlerId, isFullCrawl = false } = options;

    const crawler = await prisma.crawler.findUnique({
      where: { id: crawlerId },
    });

    if (!crawler) {
      throw new Error(`Crawler with ID '${crawlerId}' not found`);
    }

    if (!crawler.enabled) {
      throw new Error(`Crawler '${crawler.name}' is disabled`);
    }

    if (crawler.isRunning || this.activeControllers.has(crawlerId)) {
      throw new Error(`Crawler '${crawler.name}' is already running another crawl operation`);
    }

    const run = await prisma.crawlRun.create({
      data: {
        crawlerId,
        status: CrawlRunStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    await prisma.crawler.update({
      where: { id: crawlerId },
      data: { isRunning: true },
    });

    const abortController = new AbortController();
    this.activeControllers.set(crawlerId, abortController);

    setImmediate(() => {
      this.executeCrawl(run.id, crawlerId, isFullCrawl, abortController.signal).catch((err) => {
        logger.error(`Unhandled error during crawl execution for run ${run.id}:`, err);
      });
    });

    logger.info(`Crawl run ${run.id} started for crawler '${crawler.name}' (Full crawl: ${isFullCrawl})`);

    return { crawlRunId: run.id };
  }

  private async executeCrawl(
    crawlRunId: string,
    crawlerId: string,
    isFullCrawl: boolean,
    signal: AbortSignal
  ): Promise<void> {
    const crawler = await prisma.crawler.findUnique({ where: { id: crawlerId } });
    if (!crawler) return;

    const settings = (crawler.settings as Record<string, any>) || {};
    const maxPages = settings.maxPages || env.CRAWLER_MAX_PAGES_PER_RUN;
    const maxConcurrency = Math.min(settings.maxConcurrency || env.CRAWLER_MAX_CONCURRENCY, 10);
    const timeoutMs = settings.requestTimeoutMs || env.CRAWLER_REQUEST_TIMEOUT_MS;
    const delayMs = settings.requestDelayMs ?? env.CRAWLER_DEFAULT_DELAY_MS;
    const maxResponseBytes = env.CRAWLER_MAX_RESPONSE_BYTES;

    let discoveredPages = 0;
    let fetchedPages = 0;
    let cleanedPages = 0;
    let skippedPages = 0;
    let failedPages = 0;
    let totalChunks = 0;
    let embeddedChunks = 0;
    let storedChunks = 0;
    let totalFetchTimeMs = 0;
    let accumulatedRunBytes = 0;
    let finalStatus: CrawlRunStatus = CrawlRunStatus.COMPLETED;
    let finalErrorMessage: string | null = null;

    try {
      const collectionName = sanitizeCollectionName(crawler.name);
      await qdrantService.ensureCollection(collectionName);

      logger.info(`Parsing sitemap: ${crawler.sitemapUrl}`, { crawlerId, crawlRunId });
      const sitemapEntries = await sitemapService.fetchAndParse(crawler.sitemapUrl, {
        allowedHosts: crawler.allowedHosts,
        includePatterns: crawler.includePatterns,
        excludePatterns: crawler.excludePatterns,
        maxPages,
        timeoutMs,
      });

      discoveredPages = sitemapEntries.length;
      logger.info(`Discovered ${discoveredPages} eligible URLs from sitemap`, { crawlerId, crawlRunId });

      await prisma.crawlRun.update({
        where: { id: crawlRunId },
        data: {
          totalPages: discoveredPages,
          discoveredPages,
          queuedPages: discoveredPages,
        },
      });

      if (discoveredPages === 0) {
        logger.info(`No pages discovered to crawl. Completing run ${crawlRunId}.`);
        finalStatus = CrawlRunStatus.COMPLETED;
        return;
      }

      const pageBatchSize = 100;
      for (let i = 0; i < sitemapEntries.length; i += pageBatchSize) {
        const batch = sitemapEntries.slice(i, i + pageBatchSize);
        await prisma.crawlRunPage.createMany({
          data: batch.map((entry) => ({
            crawlRunId,
            url: entry.url,
            status: PageStatus.QUEUED,
          })),
        });
      }

      let queueIndex = 0;
      const workerCount = Math.max(1, maxConcurrency);

      const worker = async () => {
        while (queueIndex < sitemapEntries.length) {
          if (signal.aborted) {
            throw new Error('Crawl cancelled by user request');
          }

          const itemIndex = queueIndex++;
          if (itemIndex >= sitemapEntries.length) break;
          const entry = sitemapEntries[itemIndex];

          await this.processSinglePage({
            entryUrl: entry.url,
            crawlerId,
            crawlRunId,
            crawler,
            isFullCrawl,
            timeoutMs,
            delayMs,
            maxResponseBytes,
            signal,
            onSuccess: (meta) => {
              fetchedPages++;
              cleanedPages += meta.isNewOrUpdated ? 1 : 0;
              skippedPages += meta.isSkipped ? 1 : 0;
              totalChunks += meta.chunksCount;
              embeddedChunks += meta.chunksCount;
              storedChunks += meta.chunksCount;
              totalFetchTimeMs += meta.fetchDurationMs;
              accumulatedRunBytes += meta.estimatedBytes;
            },
            onFailure: (err) => {
              failedPages++;
              logger.warn(`Failed page ${entry.url}: ${err.message}`, { crawlRunId });
            },
          });

          if (itemIndex % 5 === 0 || itemIndex === sitemapEntries.length - 1) {
            const avgTime = fetchedPages > 0 ? totalFetchTimeMs / fetchedPages : 0;
            await prisma.crawlRun.update({
              where: { id: crawlRunId },
              data: {
                queuedPages: Math.max(0, discoveredPages - (fetchedPages + failedPages + skippedPages)),
                processingPages: Math.min(workerCount, discoveredPages - itemIndex),
                fetchedPages,
                cleanedPages,
                skippedPages,
                failedPages,
                totalChunks,
                embeddedChunks,
                storedChunks,
                storageUsedBytes: BigInt(accumulatedRunBytes),
                averageFetchTimeMs: Math.round(avgTime),
              },
            });
          }
        }
      };

      const workers = Array.from({ length: workerCount }, () => worker());
      await Promise.all(workers);

      if (failedPages > 0 && (cleanedPages > 0 || skippedPages > 0)) {
        finalStatus = CrawlRunStatus.PARTIALLY_COMPLETED;
      } else if (failedPages > 0 && cleanedPages === 0 && skippedPages === 0) {
        finalStatus = CrawlRunStatus.FAILED;
      } else {
        finalStatus = CrawlRunStatus.COMPLETED;
      }
    } catch (err: any) {
      if (signal.aborted || err.message?.includes('cancelled')) {
        finalStatus = CrawlRunStatus.CANCELLED;
        finalErrorMessage = 'Crawl was manually cancelled';
      } else if (err instanceof StorageBudgetExceededError) {
        finalStatus = CrawlRunStatus.PARTIALLY_COMPLETED;
        finalErrorMessage = err.message;
      } else {
        finalStatus = CrawlRunStatus.FAILED;
        finalErrorMessage = err.message;
      }
      logger.error(`Crawl run ${crawlRunId} ended with status ${finalStatus}: ${err.message}`);
    } finally {
      this.activeControllers.delete(crawlerId);

      const avgTime = fetchedPages > 0 ? totalFetchTimeMs / fetchedPages : 0;
      await prisma.crawlRun.update({
        where: { id: crawlRunId },
        data: {
          status: finalStatus,
          errorMessage: finalErrorMessage,
          fetchedPages,
          cleanedPages,
          skippedPages,
          failedPages,
          totalChunks,
          embeddedChunks,
          storedChunks,
          storageUsedBytes: BigInt(accumulatedRunBytes),
          averageFetchTimeMs: Math.round(avgTime),
          completedAt: new Date(),
        },
      });

      await prisma.crawler.update({
        where: { id: crawlerId },
        data: { isRunning: false },
      });

      logger.info(
        `Crawl run ${crawlRunId} finished. Status: ${finalStatus}, Cleaned: ${cleanedPages}, Skipped: ${skippedPages}, Failed: ${failedPages}, Chunks: ${storedChunks}`
      );
    }
  }

  private async processSinglePage(params: {
    entryUrl: string;
    crawlerId: string;
    crawlRunId: string;
    crawler: any;
    isFullCrawl: boolean;
    timeoutMs: number;
    delayMs: number;
    maxResponseBytes: number;
    signal: AbortSignal;
    onSuccess: (meta: {
      isNewOrUpdated: boolean;
      isSkipped: boolean;
      chunksCount: number;
      fetchDurationMs: number;
      estimatedBytes: number;
    }) => void;
    onFailure: (err: Error) => void;
  }): Promise<void> {
    const {
      entryUrl,
      crawlerId,
      crawlRunId,
      crawler,
      isFullCrawl,
      timeoutMs,
      delayMs,
      maxResponseBytes,
      signal,
      onSuccess,
      onFailure,
    } = params;

    let fetchDurationMs = 0;
    let contentBytes = 0;
    let httpStatus = 200;

    try {
      const fetchResult = await fetcherService.fetchWithRetry(
        entryUrl,
        {
          timeoutMs,
          delayMs,
          maxResponseBytes,
          allowedHosts: crawler.allowedHosts,
          signal,
        },
        2
      );

      fetchDurationMs = fetchResult.fetchDurationMs;
      contentBytes = fetchResult.contentBytes;
      httpStatus = fetchResult.httpStatus;

      const extracted = contentExtractorService.extract(fetchResult.html, fetchResult.finalUrl);

      if (!extracted.content || extracted.content.trim().length === 0) {
        throw new Error('Extracted content is empty or unreadable');
      }

      const newContentHash = hashContent(extracted.content);

      const existingPage = await prisma.crawledPage.findUnique({
        where: {
          crawlerId_canonicalUrl: {
            crawlerId,
            canonicalUrl: extracted.canonicalUrl,
          },
        },
        include: { chunks: true },
      });

      if (!isFullCrawl && existingPage && existingPage.contentHash === newContentHash) {
        logger.debug(`Page content unchanged, skipping indexing: ${entryUrl}`);

        await prisma.crawledPage.update({
          where: { id: existingPage.id },
          data: {
            lastCrawledAt: new Date(),
            httpStatus,
            contentBytes,
          },
        });

        await prisma.crawlRunPage.updateMany({
          where: { crawlRunId, url: entryUrl },
          data: {
            status: PageStatus.SKIPPED,
            httpStatus,
            fetchDurationMs,
            contentBytes,
            chunksCount: existingPage.chunksCount,
            processedAt: new Date(),
          },
        });

        onSuccess({
          isNewOrUpdated: false,
          isSkipped: true,
          chunksCount: 0,
          fetchDurationMs,
          estimatedBytes: 0,
        });
        return;
      }

      const crawledPage = await prisma.crawledPage.upsert({
        where: {
          crawlerId_canonicalUrl: {
            crawlerId,
            canonicalUrl: extracted.canonicalUrl,
          },
        },
        create: {
          crawlerId,
          url: entryUrl,
          canonicalUrl: extracted.canonicalUrl,
          title: extracted.title,
          description: extracted.description,
          contentHash: newContentHash,
          httpStatus,
          contentBytes,
          status: PageStatus.FETCHED,
          lastCrawledAt: new Date(),
        },
        update: {
          url: entryUrl,
          title: extracted.title,
          description: extracted.description,
          contentHash: newContentHash,
          httpStatus,
          contentBytes,
          status: PageStatus.FETCHED,
          lastCrawledAt: new Date(),
          lastError: null,
        },
      });

      const chunks = chunkingService.chunkText(
        extracted.content,
        {
          crawlerId,
          pageId: crawledPage.id,
          url: entryUrl,
          title: extracted.title,
        },
        {
          chunkSize: env.CHUNK_SIZE,
          chunkOverlap: env.CHUNK_OVERLAP,
        }
      );

      const collectionName = sanitizeCollectionName(crawler.name);
      await storageService.checkAndEnforceBudget(chunks, 0, collectionName);
      const estimatedBytes = storageService.estimateBatchBytes(chunks);

      const enrichedChunks = chunks.map((c) => ({
        ...c,
        ...(crawler.knowledgeBaseId ? { knowledgeBaseId: crawler.knowledgeBaseId } : {}),
        scope: crawler.scope,
        workspaceId: crawler.scope === 'PLATFORM' ? null : (crawler.workspaceId ?? null),
        status: 'ACTIVE' as const,
      }));

      const crawledAt = new Date().toISOString();
      const { pointIds } = await qdrantService.upsertChunks(enrichedChunks, crawledAt, collectionName);

      if (existingPage && existingPage.chunks.length > chunks.length) {
        const obsoletePointIds = existingPage.chunks
          .slice(chunks.length)
          .map((c) => c.qdrantPointId);
        await qdrantService.deletePoints(obsoletePointIds, collectionName);
      }

      await prisma.crawledChunk.deleteMany({
        where: { pageId: crawledPage.id },
      });

      await prisma.crawledChunk.createMany({
        data: chunks.map((c, i) => ({
          pageId: crawledPage.id,
          qdrantPointId: pointIds[i],
          chunkIndex: c.chunkIndex,
          contentHash: c.contentHash,
          tokenCount: c.tokenCount,
        })),
      });

      await prisma.crawledPage.update({
        where: { id: crawledPage.id },
        data: {
          chunksCount: chunks.length,
          status: PageStatus.COMPLETED,
        },
      });

      await prisma.crawlRunPage.updateMany({
        where: { crawlRunId, url: entryUrl },
        data: {
          status: PageStatus.COMPLETED,
          httpStatus,
          fetchDurationMs,
          contentBytes,
          chunksCount: chunks.length,
          processedAt: new Date(),
        },
      });

      onSuccess({
        isNewOrUpdated: true,
        isSkipped: false,
        chunksCount: chunks.length,
        fetchDurationMs,
        estimatedBytes,
      });
    } catch (err: any) {
      await prisma.crawlRunPage.updateMany({
        where: { crawlRunId, url: entryUrl },
        data: {
          status: PageStatus.FAILED,
          httpStatus: httpStatus || null,
          fetchDurationMs: fetchDurationMs || null,
          contentBytes: contentBytes || 0,
          errorMessage: err.message,
          processedAt: new Date(),
        },
      });

      onFailure(err);

      if (err instanceof StorageBudgetExceededError) {
        throw err;
      }
    }
  }
}

export const crawlService = new CrawlService();
export default crawlService;
export { StartCrawlOptions };
