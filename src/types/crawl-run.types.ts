import { CrawlRun, PageStatus } from '@prisma/client';

export interface StartCrawlOptions {
  crawlerId: string;
  isFullCrawl?: boolean;
}

export interface FindRunsOptions {
  crawlerId?: string;
  skip?: number;
  take?: number;
}

export interface FindPagesOptions {
  crawlRunId: string;
  status?: PageStatus;
  skip?: number;
  take?: number;
}

export interface ProgressSummary {
  crawlRunId: string;
  crawlerId: string;
  status: string;
  progressPercentage: number;
  progress: {
    totalPages: number;
    discoveredPages: number;
    queuedPages: number;
    processingPages: number;
    fetchedPages: number;
    cleanedPages: number;
    skippedPages: number;
    failedPages: number;
    totalChunks: number;
    embeddedChunks: number;
    storedChunks: number;
  };
  metrics: {
    averageFetchTimeMs: number;
    totalFetchedBytes: number;
    storageUsedBytes: number;
    storageBudgetBytes: number;
    storageUsagePercentage: number;
    storageUsageSource: 'ESTIMATED' | 'QDRANT_REPORTED';
  };
  timestamps: {
    createdAt: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  errors: Array<{ url: string; error: string; timestamp?: string }>;
}

export interface SerializedCrawlRun extends Omit<CrawlRun, 'storageUsedBytes'> {
  storageUsedBytes: number;
}

