import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors';
import { WorkspaceContext, WORKSPACE_EDITOR_ROLES } from '../../middleware/auth';
import qdrantService from '../../services/qdrant.service';
import chunkingService from '../../services/chunking.service';
import { sanitizeCollectionName } from '../../utils/hashing';
import logger from '../../lib/logger';

export interface CreateKnowledgeBaseDTO {
  name: string;
  description?: string;
  scope?: 'PLATFORM' | 'WORKSPACE';
  qdrantCollection?: string;
  retrievalDefaults?: {
    topK?: number;
    scoreThreshold?: number;
  };
}

export interface IngestTextDocumentDTO {
  title: string;
  content: string;
  uri?: string;
  metadata?: Record<string, any>;
}

export interface LegacyMigrationClassification {
  crawlerId: string;
  targetScope: 'PLATFORM' | 'WORKSPACE' | 'QUARANTINED';
  targetWorkspaceId?: string;
}

export class KnowledgeService {
  private assertCanManageWorkspaceKB(ctx: WorkspaceContext) {
    if (
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to manage knowledge bases');
    }
  }

  async createKnowledgeBase(ctx: WorkspaceContext, input: CreateKnowledgeBaseDTO) {
    const scope = input.scope ?? 'WORKSPACE';
    if (scope === 'WORKSPACE') {
      this.assertCanManageWorkspaceKB(ctx);
    }

    const qdrantCollection =
      input.qdrantCollection ||
      (scope === 'PLATFORM'
        ? 'platform_knowledge_base'
        : sanitizeCollectionName(`kb_${ctx.workspaceId}_${input.name}`));

    await qdrantService.ensureCollection(qdrantCollection);

    return prisma.knowledgeBase.create({
      data: {
        scope,
        workspaceId: scope === 'PLATFORM' ? null : ctx.workspaceId,
        ownerUserId: ctx.userId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        qdrantCollection,
        retrievalDefaults: input.retrievalDefaults ?? { topK: 5, scoreThreshold: 0.5 },
        status: 'ACTIVE',
      },
    });
  }

  async listKnowledgeBases(ctx: WorkspaceContext) {
    return prisma.knowledgeBase.findMany({
      where: {
        status: { not: 'ARCHIVED' },
        OR: [
          { scope: 'WORKSPACE', workspaceId: ctx.workspaceId },
          { scope: 'PLATFORM', status: 'ACTIVE' },
        ],
      },
      include: {
        _count: { select: { documents: true, crawlers: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getKnowledgeBaseById(ctx: WorkspaceContext, kbId: string) {
    const kb = await prisma.knowledgeBase.findUnique({
      where: { id: kbId },
      include: {
        _count: { select: { documents: true, crawlers: true } },
      },
    });

    if (!kb) {
      throw new NotFoundError(`Knowledge base '${kbId}' not found`);
    }

    if (kb.scope === 'WORKSPACE' && kb.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Knowledge base '${kbId}' not found in this workspace`);
    }

    return kb;
  }

  async updateKnowledgeBase(
    ctx: WorkspaceContext,
    kbId: string,
    input: { name?: string; description?: string | null; retrievalDefaults?: Record<string, any>; status?: 'ACTIVE' | 'ARCHIVED' | 'QUARANTINED' }
  ) {
    const kb = await this.getKnowledgeBaseById(ctx, kbId);
    if (kb.scope === 'WORKSPACE') {
      this.assertCanManageWorkspaceKB(ctx);
    }

    return prisma.knowledgeBase.update({
      where: { id: kb.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.retrievalDefaults !== undefined
          ? { retrievalDefaults: input.retrievalDefaults as Prisma.InputJsonValue }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
  }

  async ingestTextDocument(ctx: WorkspaceContext, kbId: string, input: IngestTextDocumentDTO) {
    const kb = await this.getKnowledgeBaseById(ctx, kbId);
    if (kb.scope === 'WORKSPACE') {
      this.assertCanManageWorkspaceKB(ctx);
    }
    if (kb.status !== 'ACTIVE') {
      throw new BadRequestError(`Cannot ingest into knowledge base with status '${kb.status}'`);
    }

    const contentHash = crypto.createHash('sha256').update(input.content).digest('hex');
    const doc = await prisma.knowledgeDocument.create({
      data: {
        knowledgeBaseId: kb.id,
        workspaceId: kb.scope === 'PLATFORM' ? null : ctx.workspaceId,
        sourceType: 'TEXT',
        title: input.title.trim(),
        uri: input.uri || `kb://${kb.id}/${contentHash.slice(0, 12)}`,
        contentHash,
        status: 'INDEXING',
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    const chunks = chunkingService.chunkText(input.content, {
      crawlerId: `kb_${kb.id}`,
      pageId: doc.id,
      url: doc.uri || `kb://${kb.id}/${doc.id}`,
      title: doc.title,
    });

    const { upsertedCount } = await qdrantService.upsertChunks(
      chunks,
      new Date().toISOString(),
      kb.qdrantCollection,
      undefined,
      {
        knowledgeBaseId: kb.id,
        scope: kb.scope,
        workspaceId: kb.workspaceId,
        documentId: doc.id,
        status: 'ACTIVE',
      }
    );

    const updatedDoc = await prisma.knowledgeDocument.update({
      where: { id: doc.id },
      data: {
        chunkCount: upsertedCount,
        status: 'ACTIVE',
      },
    });

    return updatedDoc;
  }

  async attachToAgent(
    ctx: WorkspaceContext,
    agentId: string,
    kbId: string,
    retrievalConfig?: Record<string, any>
  ) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${agentId}' not found in this workspace`);
    }

    const kb = await this.getKnowledgeBaseById(ctx, kbId);
    if (kb.status !== 'ACTIVE') {
      throw new BadRequestError(`Knowledge base '${kbId}' is not active`);
    }

    const existing = await prisma.agentKnowledgeBase.findFirst({
      where: { agentId, agentVersionId: null, knowledgeBaseId: kbId },
    });

    if (existing) {
      return prisma.agentKnowledgeBase.update({
        where: { id: existing.id },
        data: {
          isEnabled: true,
          ...(retrievalConfig ? { retrievalConfig: retrievalConfig as Prisma.InputJsonValue } : {}),
        },
        include: { knowledgeBase: true },
      });
    }

    return prisma.agentKnowledgeBase.create({
      data: {
        agentId,
        knowledgeBaseId: kbId,
        retrievalConfig: (retrievalConfig ?? { topK: 5, scoreThreshold: 0.5 }) as Prisma.InputJsonValue,
        isEnabled: true,
      },
      include: { knowledgeBase: true },
    });
  }

  async detachFromAgent(ctx: WorkspaceContext, agentId: string, kbId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${agentId}' not found in this workspace`);
    }

    await prisma.agentKnowledgeBase.deleteMany({
      where: { agentId, agentVersionId: null, knowledgeBaseId: kbId },
    });

    return { detached: true };
  }

  async listAgentKbs(ctx: WorkspaceContext, agentId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || (!agent.isSystem && agent.workspaceId !== ctx.workspaceId)) {
      throw new NotFoundError(`Agent '${agentId}' not found in this workspace`);
    }

    return prisma.agentKnowledgeBase.findMany({
      where: { agentId, agentVersionId: null },
      include: { knowledgeBase: true },
    });
  }

  /**
   * Auditable legacy crawler migration: assigns unclassified Crawlers to the legacy
   * PLATFORM KB, a target WORKSPACE KB, or a QUARANTINED KB, and backfills Qdrant payloads.
   */
  async migrateLegacyCrawlers(
    ctx: WorkspaceContext,
    classifications: LegacyMigrationClassification[]
  ) {
    const results: Array<{ crawlerId: string; knowledgeBaseId: string; status: string }> = [];

    let platformKb = await prisma.knowledgeBase.findFirst({
      where: { scope: 'PLATFORM', name: 'Legacy Website Content' },
    });

    if (!platformKb) {
      platformKb = await prisma.knowledgeBase.create({
        data: {
          scope: 'PLATFORM',
          workspaceId: null,
          ownerUserId: ctx.userId,
          name: 'Legacy Website Content',
          description: 'Controlled platform knowledge base for migrated legacy website crawlers',
          qdrantCollection: qdrantService.defaultCollectionName,
          retrievalDefaults: { topK: 5, scoreThreshold: 0.5 },
          status: 'ACTIVE',
        },
      });
    }

    for (const item of classifications) {
      const crawler = await prisma.crawler.findUnique({ where: { id: item.crawlerId } });
      if (!crawler) continue;

      let targetKbId = platformKb.id;
      let targetScope: 'PLATFORM' | 'WORKSPACE' = 'PLATFORM';
      let targetWorkspaceId: string | null = null;

      if (item.targetScope === 'WORKSPACE' && item.targetWorkspaceId) {
        targetScope = 'WORKSPACE';
        targetWorkspaceId = item.targetWorkspaceId;
        const wsKb = await prisma.knowledgeBase.create({
          data: {
            scope: 'WORKSPACE',
            workspaceId: targetWorkspaceId,
            ownerUserId: ctx.userId,
            name: crawler.name,
            qdrantCollection: sanitizeCollectionName(crawler.name),
            status: 'ACTIVE',
          },
        });
        targetKbId = wsKb.id;
      } else if (item.targetScope === 'QUARANTINED') {
        targetScope = 'WORKSPACE';
        targetWorkspaceId = item.targetWorkspaceId || ctx.workspaceId;
        const qKb = await prisma.knowledgeBase.create({
          data: {
            scope: 'WORKSPACE',
            workspaceId: targetWorkspaceId,
            ownerUserId: ctx.userId,
            name: `${crawler.name} (Quarantined)`,
            qdrantCollection: sanitizeCollectionName(crawler.name),
            status: 'QUARANTINED',
          },
        });
        targetKbId = qKb.id;
      }

      await prisma.crawler.update({
        where: { id: crawler.id },
        data: {
          scope: targetScope,
          workspaceId: targetWorkspaceId,
          knowledgeBaseId: targetKbId,
        },
      });

      try {
        const colName = sanitizeCollectionName(crawler.name);
        const client = qdrantService.getVectorStore(colName).client as any;
        await qdrantService.ensurePayloadIndexes(client, colName);
        await client.setPayload(colName, {
          payload: {
            knowledgeBaseId: targetKbId,
            scope: targetScope,
            workspaceId: targetWorkspaceId,
            status: item.targetScope === 'QUARANTINED' ? 'QUARANTINED' : 'ACTIVE',
          },
          filter: {
            should: [
              { key: 'crawlerId', match: { value: crawler.id } },
              { key: 'metadata.crawlerId', match: { value: crawler.id } },
            ],
          },
        });
      } catch (err: any) {
        logger.warn(`[KnowledgeMigration] Qdrant backfill skipped/partial for crawler=${crawler.id}: ${err.message}`);
      }

      results.push({
        crawlerId: crawler.id,
        knowledgeBaseId: targetKbId,
        status: item.targetScope,
      });
    }

    return results;
  }
}

export const knowledgeService = new KnowledgeService();
export default knowledgeService;
