import { Crawler } from '@prisma/client';
import { StorageBudgetStatus } from './storage.types';

export interface CrawlerSettings {
  maxPages: number;
  maxConcurrency: number;
  requestTimeoutMs: number;
  requestDelayMs: number;
}

export interface CreateCrawlerDto {
  name: string;
  sitemapUrl: string;
  baseUrl?: string;
  allowedHosts?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  maxPages?: number;
  maxConcurrency?: number;
  requestTimeoutMs?: number;
  requestDelayMs?: number;
  enabled?: boolean;
}

export interface UpdateCrawlerDto extends Partial<CreateCrawlerDto> {}

export interface CrawlerMetricsResponse {
  crawlerId: string;
  totalPages: number;
  totalChunks: number;
  totalBytes: number;
  totalRuns: number;
  lastRunStatus: string | null;
  lastCrawledAt: Date | null;
  pageBreakdown: Array<{
    status: string;
    count: number;
  }>;
  storage: StorageBudgetStatus;
}

