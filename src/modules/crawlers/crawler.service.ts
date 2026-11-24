import crawlerRepository, { CrawlerRepository } from './crawler.repository';
import { validateSafeUrl } from '../../utils/url';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import { Crawler } from '@prisma/client';
import crawlService from '../../services/crawl.service';
import qdrantService from '../../services/qdrant.service';
import storageService from '../../services/storage.service';
import logger from '../../lib/logger';
import { CreateCrawlerDto, UpdateCrawlerDto, CrawlerMetricsResponse } from '../../types';

export class CrawlerService {
  constructor(private repo: CrawlerRepository = crawlerRepository) {}

  async createCrawler(dto: CreateCrawlerDto): Promise<Crawler> {
    const parsedUrl = validateSafeUrl(dto.sitemapUrl);
    const origin = parsedUrl.origin;
    const hostname = parsedUrl.hostname;

    const baseUrl = dto.baseUrl || origin;
    const allowedHosts =
      dto.allowedHosts && dto.allowedHosts.length > 0 ? dto.allowedHosts : [hostname];

    const settings = {
      maxPages: dto.maxPages ?? 1000,
      maxConcurrency: dto.maxConcurrency ?? 3,
      requestTimeoutMs: dto.requestTimeoutMs ?? 15000,
      requestDelayMs: dto.requestDelayMs ?? 500,
    };

    const crawler = await this.repo.create({
      name: dto.name,
      sitemapUrl: dto.sitemapUrl,
      baseUrl,
      allowedHosts,
      includePatterns: dto.includePatterns || [],
      excludePatterns: dto.excludePatterns || [],
      settings,
      enabled: dto.enabled !== undefined ? dto.enabled : true,
    });

    logger.info(`Crawler created: ${crawler.name} (${crawler.id})`);
    return crawler;
  }

  async getAllCrawlers(): Promise<Crawler[]> {
    return this.repo.findAll();
  }

  async getCrawlerById(id: string): Promise<Crawler> {
    const crawler = await this.repo.findById(id);
    if (!crawler) {
      throw new NotFoundError(`Crawler with ID '${id}' not found`);
    }
    return crawler;
  }

  async updateCrawler(id: string, dto: UpdateCrawlerDto): Promise<Crawler> {
    const existing = await this.getCrawlerById(id);

    if (existing.isRunning) {
      throw new BadRequestError('Cannot update crawler settings while a crawl is running');
    }

    if (dto.sitemapUrl) {
      validateSafeUrl(dto.sitemapUrl);
    }

    const currentSettings = (existing.settings as Record<string, any>) || {};
    const updatedSettings = {
      ...currentSettings,
      ...(dto.maxPages !== undefined && { maxPages: dto.maxPages }),
      ...(dto.maxConcurrency !== undefined && { maxConcurrency: dto.maxConcurrency }),
      ...(dto.requestTimeoutMs !== undefined && { requestTimeoutMs: dto.requestTimeoutMs }),
      ...(dto.requestDelayMs !== undefined && { requestDelayMs: dto.requestDelayMs }),
    };

    return this.repo.update(id, {
      ...(dto.name && { name: dto.name }),
      ...(dto.sitemapUrl && { sitemapUrl: dto.sitemapUrl }),
      ...(dto.baseUrl && { baseUrl: dto.baseUrl }),
      ...(dto.allowedHosts && { allowedHosts: dto.allowedHosts }),
      ...(dto.includePatterns && { includePatterns: dto.includePatterns }),
      ...(dto.excludePatterns && { excludePatterns: dto.excludePatterns }),
      settings: updatedSettings,
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
    });
  }

  async deleteCrawler(id: string): Promise<{ success: boolean; message: string }> {
    const crawler = await this.getCrawlerById(id);
    if (crawler.isRunning) {
      await crawlService.cancelCrawl(id);
    }

    try {
      await qdrantService.deleteByCrawlerId(id);
    } catch (err: any) {
      logger.warn(`Could not clean up Qdrant vectors for crawler ${id}: ${err.message}`);
    }

    await this.repo.delete(id);
    logger.info(`Deleted crawler ${crawler.name} (${id})`);
    return { success: true, message: `Crawler '${crawler.name}' deleted successfully` };
  }

  async triggerCrawl(id: string, isFullCrawl = false) {
    return crawlService.triggerCrawl({ crawlerId: id, isFullCrawl });
  }

  async cancelCrawl(id: string) {
    const cancelled = await crawlService.cancelCrawl(id);
    return {
      success: true,
      message: cancelled ? 'Crawl cancelled successfully' : 'No active crawl was running for this crawler',
    };
  }

  async getCrawlerMetrics(id: string): Promise<CrawlerMetricsResponse> {
    await this.getCrawlerById(id);
    const dbMetrics = await this.repo.getCrawlerMetrics(id);
    const storageMetrics = await storageService.getStorageMetrics();

    return {
      ...dbMetrics,
      storage: storageMetrics,
    };
  }
}

export const crawlerService = new CrawlerService();
export default crawlerService;
export { CreateCrawlerDto, UpdateCrawlerDto };
