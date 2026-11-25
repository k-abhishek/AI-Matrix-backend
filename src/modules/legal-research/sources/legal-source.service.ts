import prisma from '../../../lib/prisma';
import {
  INITIAL_INDIAN_LEGAL_SOURCES,
  OfficialLegalSourceSeed,
} from './legal-sources.config';

export class LegalSourceService {
  /**
   * Idempotently upserts the official Indian legal sources into the existing LegalSource table.
   */
  async upsertInitialLegalSources(
    seeds: OfficialLegalSourceSeed[] = INITIAL_INDIAN_LEGAL_SOURCES
  ) {
    const results = [];

    for (const seed of seeds) {
      const existing = await prisma.legalSource.findFirst({
        where: {
          OR: [
            { sourceKey: seed.sourceKey },
            { name: seed.name },
            { baseUrl: seed.baseUrl },
          ],
        },
      });

      if (existing) {
        const updated = await prisma.legalSource.update({
          where: { id: existing.id },
          data: {
            sourceKey: seed.sourceKey,
            sourceType: seed.sourceType,
            authorityTier: seed.authorityTier,
            baseUrl: seed.baseUrl,
            jurisdiction: seed.jurisdiction,
            jurisdictionLevel: seed.jurisdictionLevel,
            ingestionMethod: 'WEB_CRAWL',
            enabled: seed.metadata.enabled,
            description: seed.description,
            verificationStatus: 'VERIFIED',
            crawlConfig: seed.crawlConfig as any,
            metadata: seed.metadata as any,
          },
        });
        results.push(updated);
      } else {
        const created = await prisma.legalSource.create({
          data: {
            sourceKey: seed.sourceKey,
            name: seed.name,
            sourceType: seed.sourceType,
            authorityTier: seed.authorityTier,
            baseUrl: seed.baseUrl,
            jurisdiction: seed.jurisdiction,
            jurisdictionLevel: seed.jurisdictionLevel,
            ingestionMethod: 'WEB_CRAWL',
            enabled: seed.metadata.enabled,
            description: seed.description,
            verificationStatus: 'VERIFIED',
            crawlConfig: seed.crawlConfig as any,
            metadata: seed.metadata as any,
            ingestionStatus: 'PENDING',
          },
        });
        results.push(created);
      }
    }

    return results;
  }

  async getEnabledLegalSources() {
    return prisma.legalSource.findMany({
      where: {
        enabled: true,
        ingestionMethod: 'WEB_CRAWL',
      },
      orderBy: { name: 'asc' },
    });
  }

  async updateSourceStatus(
    sourceId: string,
    stats: {
      ingestionStatus: string;
      runId: string;
      discoveredCount?: number;
      downloadedCount?: number;
      extractedCount?: number;
      persistedCount?: number;
      indexedCount?: number;
      failedCount?: number;
      lastError?: string | null;
      succeeded?: boolean;
    }
  ) {
    const now = new Date();
    return prisma.legalSource.update({
      where: { id: sourceId },
      data: {
        ingestionStatus: stats.ingestionStatus,
        lastIngestionAt: now,
        lastRunId: stats.runId,
        ...(stats.succeeded ? { lastSuccessAt: now } : {}),
        ...(stats.discoveredCount !== undefined ? { discoveredCount: stats.discoveredCount } : {}),
        ...(stats.downloadedCount !== undefined ? { downloadedCount: stats.downloadedCount } : {}),
        ...(stats.extractedCount !== undefined ? { extractedCount: stats.extractedCount } : {}),
        ...(stats.persistedCount !== undefined ? { persistedCount: stats.persistedCount } : {}),
        ...(stats.indexedCount !== undefined ? { indexedCount: stats.indexedCount } : {}),
        ...(stats.failedCount !== undefined ? { failedCount: stats.failedCount } : {}),
        ...(stats.lastError !== undefined ? { lastError: stats.lastError } : {}),
      },
    });
  }
}

export const legalSourceService = new LegalSourceService();
export default legalSourceService;
