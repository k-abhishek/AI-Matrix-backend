import prisma from '../../lib/prisma';
import qdrantService from '../../services/qdrant.service';
import { sanitizeCollectionName } from '../../utils/hashing';
import logger from '../../lib/logger';

export interface LegacyCrawlerClassification {
  crawlerId: string;
  target: 'PLATFORM' | 'QUARANTINED' | 'WORKSPACE';
  workspaceId?: string;
}

export interface MigrationAuditReport {
  platformKnowledgeBaseId: string;
  migratedCrawlers: number;
  quarantinedCrawlers: number;
  backfilledQdrantPoints: number;
  validationPassed: boolean;
  details: Array<{
    crawlerId: string;
    crawlerName: string;
    target: string;
    pointsUpdated: number;
  }>;
}

export class KnowledgeMigrationService {
  /**
   * Ensures the dedicated legacy PLATFORM KnowledgeBase exists for `website_content`.
   */
  async ensureLegacyPlatformKnowledgeBase(adminUserId = 'system') {
    const existing = await prisma.knowledgeBase.findFirst({
      where: {
        scope: 'PLATFORM',
        name: 'Legacy Platform Knowledge Base',
      },
    });
    if (existing) return existing;

    return prisma.knowledgeBase.create({
      data: {
        scope: 'PLATFORM',
        workspaceId: null,
        ownerUserId: adminUserId,
        name: 'Legacy Platform Knowledge Base',
        description: 'Controlled platform-level knowledge base for audited legacy website_content.',
        qdrantCollection: qdrantService.defaultCollectionName,
        retrievalDefaults: { topK: 5, scoreThreshold: 0.5 },
        status: 'ACTIVE',
      },
    });
  }

  /**
   * Executes an auditable backfill of existing Crawlers and Qdrant points
   * based on explicit pre-migration classifications.
   */
  async migrateLegacyCrawlers(
    classifications: LegacyCrawlerClassification[],
    adminUserId = 'system'
  ): Promise<MigrationAuditReport> {
    const platformKb = await this.ensureLegacyPlatformKnowledgeBase(adminUserId);
    let migratedCrawlers = 0;
    let quarantinedCrawlers = 0;
    let backfilledQdrantPoints = 0;
    const details: MigrationAuditReport['details'] = [];

    for (const item of classifications) {
      const crawler = await prisma.crawler.findUnique({ where: { id: item.crawlerId } });
      if (!crawler) continue;

      let targetKbId = platformKb.id;
      let targetScope: 'PLATFORM' | 'WORKSPACE' = 'PLATFORM';
      let targetWorkspaceId: string | null = null;

      if (item.target === 'QUARANTINED') {
        const quarantineKb = await prisma.knowledgeBase.create({
          data: {
            scope: 'WORKSPACE',
            workspaceId: item.workspaceId || 'quarantine',
            ownerUserId: adminUserId,
            name: `Quarantined: ${crawler.name}`,
            qdrantCollection: sanitizeCollectionName(crawler.name),
            status: 'QUARANTINED',
          },
        });
        targetKbId = quarantineKb.id;
        targetScope = 'WORKSPACE';
        targetWorkspaceId = quarantineKb.workspaceId;
        quarantinedCrawlers++;
      } else if (item.target === 'WORKSPACE' && item.workspaceId) {
        const wsKb = await prisma.knowledgeBase.create({
          data: {
            scope: 'WORKSPACE',
            workspaceId: item.workspaceId,
            ownerUserId: adminUserId,
            name: crawler.name,
            qdrantCollection: sanitizeCollectionName(crawler.name),
            status: 'ACTIVE',
          },
        });
        targetKbId = wsKb.id;
        targetScope = 'WORKSPACE';
        targetWorkspaceId = item.workspaceId;
        migratedCrawlers++;
      } else {
        migratedCrawlers++;
      }

      await prisma.crawler.update({
        where: { id: crawler.id },
        data: {
          scope: targetScope,
          workspaceId: targetWorkspaceId,
          knowledgeBaseId: targetKbId,
        },
      });

      const collectionName = sanitizeCollectionName(crawler.name);
      const pointsUpdated = await this.backfillQdrantCollectionPayloads(
        collectionName,
        crawler.id,
        {
          knowledgeBaseId: targetKbId,
          scope: targetScope,
          workspaceId: targetWorkspaceId,
          status: item.target === 'QUARANTINED' ? 'QUARANTINED' : 'ACTIVE',
        }
      );

      backfilledQdrantPoints += pointsUpdated;
      details.push({
        crawlerId: crawler.id,
        crawlerName: crawler.name,
        target: item.target,
        pointsUpdated,
      });
    }

    const unmigratedCount = await prisma.crawler.count({
      where: { knowledgeBaseId: null },
    });

    return {
      platformKnowledgeBaseId: platformKb.id,
      migratedCrawlers,
      quarantinedCrawlers,
      backfilledQdrantPoints,
      validationPassed: unmigratedCount === 0,
      details,
    };
  }

  private async backfillQdrantCollectionPayloads(
    collectionName: string,
    crawlerId: string,
    payloadPatch: Record<string, any>
  ): Promise<number> {
    try {
      const store = qdrantService.getVectorStore(collectionName);
      const client = store.client as any;
      await qdrantService.ensurePayloadIndexes(client, collectionName);

      if (typeof client.setPayload !== 'function') {
        return 0;
      }

      await client.setPayload(collectionName, {
        payload: payloadPatch,
        filter: {
          should: [
            { key: 'crawlerId', match: { value: crawlerId } },
            { key: 'metadata.crawlerId', match: { value: crawlerId } },
          ],
        },
      });
      return 1;
    } catch (err: any) {
      logger.warn(
        `[KnowledgeMigration] Could not backfill Qdrant payloads for '${collectionName}': ${err.message}`
      );
      return 0;
    }
  }
}

export const knowledgeMigrationService = new KnowledgeMigrationService();
export default knowledgeMigrationService;
