-- CreateEnum
CREATE TYPE "CrawlRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('DISCOVERED', 'QUEUED', 'PROCESSING', 'FETCHED', 'SKIPPED', 'FAILED', 'COMPLETED');

-- CreateTable
CREATE TABLE "crawlers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sitemapUrl" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "allowedHosts" TEXT[],
    "includePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludePatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawlers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_runs" (
    "id" TEXT NOT NULL,
    "crawlerId" TEXT NOT NULL,
    "status" "CrawlRunStatus" NOT NULL DEFAULT 'PENDING',
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "discoveredPages" INTEGER NOT NULL DEFAULT 0,
    "queuedPages" INTEGER NOT NULL DEFAULT 0,
    "processingPages" INTEGER NOT NULL DEFAULT 0,
    "fetchedPages" INTEGER NOT NULL DEFAULT 0,
    "cleanedPages" INTEGER NOT NULL DEFAULT 0,
    "skippedPages" INTEGER NOT NULL DEFAULT 0,
    "failedPages" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "embeddedChunks" INTEGER NOT NULL DEFAULT 0,
    "storedChunks" INTEGER NOT NULL DEFAULT 0,
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "averageFetchTimeMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawl_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawled_pages" (
    "id" TEXT NOT NULL,
    "crawlerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "contentHash" TEXT,
    "httpStatus" INTEGER,
    "contentBytes" INTEGER NOT NULL DEFAULT 0,
    "chunksCount" INTEGER NOT NULL DEFAULT 0,
    "status" "PageStatus" NOT NULL DEFAULT 'DISCOVERED',
    "lastCrawledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawled_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawled_chunks" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "qdrantPointId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawled_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_run_pages" (
    "id" TEXT NOT NULL,
    "crawlRunId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "PageStatus" NOT NULL DEFAULT 'DISCOVERED',
    "httpStatus" INTEGER,
    "fetchDurationMs" INTEGER,
    "contentBytes" INTEGER NOT NULL DEFAULT 0,
    "chunksCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawl_run_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crawl_runs_crawlerId_idx" ON "crawl_runs"("crawlerId");

-- CreateIndex
CREATE INDEX "crawl_runs_status_idx" ON "crawl_runs"("status");

-- CreateIndex
CREATE INDEX "crawled_pages_crawlerId_idx" ON "crawled_pages"("crawlerId");

-- CreateIndex
CREATE INDEX "crawled_pages_canonicalUrl_idx" ON "crawled_pages"("canonicalUrl");

-- CreateIndex
CREATE UNIQUE INDEX "crawled_pages_crawlerId_canonicalUrl_key" ON "crawled_pages"("crawlerId", "canonicalUrl");

-- CreateIndex
CREATE INDEX "crawled_chunks_pageId_idx" ON "crawled_chunks"("pageId");

-- CreateIndex
CREATE INDEX "crawled_chunks_qdrantPointId_idx" ON "crawled_chunks"("qdrantPointId");

-- CreateIndex
CREATE UNIQUE INDEX "crawled_chunks_pageId_chunkIndex_key" ON "crawled_chunks"("pageId", "chunkIndex");

-- CreateIndex
CREATE INDEX "crawl_run_pages_crawlRunId_idx" ON "crawl_run_pages"("crawlRunId");

-- CreateIndex
CREATE INDEX "crawl_run_pages_status_idx" ON "crawl_run_pages"("status");

-- AddForeignKey
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_crawlerId_fkey" FOREIGN KEY ("crawlerId") REFERENCES "crawlers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawled_pages" ADD CONSTRAINT "crawled_pages_crawlerId_fkey" FOREIGN KEY ("crawlerId") REFERENCES "crawlers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawled_chunks" ADD CONSTRAINT "crawled_chunks_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "crawled_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_run_pages" ADD CONSTRAINT "crawl_run_pages_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
