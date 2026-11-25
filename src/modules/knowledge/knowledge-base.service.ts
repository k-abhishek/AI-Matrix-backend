import crypto from 'crypto';
import prisma from '../../lib/prisma';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../lib/errors';
import {
  WorkspaceContext,
  WORKSPACE_EDITOR_ROLES,
} from '../../middleware/auth';
import qdrantService from '../../services/qdrant.service';
import chunkingService from '../../services/chunking.service';
import { sanitizeCollectionName } from '../../utils/hashing';
import knowledgeRetrievalService from './knowledge-retrieval.service';

export interface CreateKnowledgeBaseDTO {
  name: string;
  description?: string;
  scope?: 'PLATFORM' | 'WORKSPACE';
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

export class KnowledgeBaseService {
  private assertCanManageWorkspaceKb(ctx: WorkspaceContext, kb: { scope: string; workspaceId: string | null }) {
    if (kb.scope === 'PLATFORM') {
      throw new ForbiddenError('Platform knowledge bases cannot be modified by workspace users');
    }
    if (kb.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError('Knowledge base not found in this workspace');
    }
    if (
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to manage knowledge bases');
    }
  }

  async createKnowledgeBase(ctx: WorkspaceContext, input: CreateKnowledgeBaseDTO) {
    const scope = input.scope ?? 'WORKSPACE';
    if (scope === 'PLATFORM') {
      throw new ForbiddenError('Workspace users cannot create PLATFORM knowledge bases');
    }
    if (
      ctx.isOrganization &&
      (!ctx.orgRole || !WORKSPACE_EDITOR_ROLES.includes(ctx.orgRole as any))
    ) {
      throw new ForbiddenError('Workspace admin or editor role is required to create knowledge bases');
    }

    const collectionSuffix = crypto.createHash('sha1').update(ctx.workspaceId).digest('hex').slice(0, 12);
    const qdrantCollection = sanitizeCollectionName(`kb_${collectionSuffix}_${input.name}`);

    return prisma.knowledgeBase.create({
      data: {
        scope: 'WORKSPACE',
        workspaceId: ctx.workspaceId,
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
        status: 'ACTIVE',
        OR: [
          { scope: 'WORKSPACE', workspaceId: ctx.workspaceId },
          { scope: 'PLATFORM' },
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
      throw new NotFoundError(`Knowledge base '${kbId}' not found`);
    }
    if (kb.status === 'QUARANTINED') {
      throw new ForbiddenError('Knowledge base is quarantined');
    }

    return kb;
  }

  async ingestTextDocument(ctx: WorkspaceContext, kbId: string, input: IngestTextDocumentDTO) {
    const kb = await this.getKnowledgeBaseById(ctx, kbId);
    this.assertCanManageWorkspaceKb(ctx, kb);

    const contentHash = crypto.createHash('sha256').update(input.content).digest('hex');
    const docId = crypto.randomUUID();
    const uri = input.uri || `doc://${kb.id}/${docId}`;

    const chunks = chunkingService.chunkText(
      input.content,
      {
        crawlerId: kb.id,
        pageId: docId,
        url: uri,
        title: input.title,
      },
    ).map((c) => ({
      ...c,
      knowledgeBaseId: kb.id,
      scope: 'WORKSPACE' as const,
      workspaceId: kb.workspaceId,
      documentId: docId,
      status: 'ACTIVE' as const,
    }));

    if (chunks.length === 0) {
      throw new BadRequestError('Document content produced no indexable chunks');
    }

    await qdrantService.upsertChunks(chunks, new Date().toISOString(), kb.qdrantCollection);

    return prisma.knowledgeDocument.create({
      data: {
        id: docId,
        knowledgeBaseId: kb.id,
        workspaceId: kb.workspaceId,
        sourceType: 'TEXT',
        title: input.title.trim(),
        uri,
        contentHash,
        chunkCount: chunks.length,
        status: 'ACTIVE',
        metadata: input.metadata ?? undefined,
      },
    });
  }

  async testRetrieval(
    ctx: WorkspaceContext,
    kbId: string,
    input: { query: string; topK?: number; scoreThreshold?: number; metadataFilters?: Record<string, any> }
  ) {
    await this.getKnowledgeBaseById(ctx, kbId);
    const hits = await knowledgeRetrievalService.retrieve({
      query: input.query,
      workspaceId: ctx.workspaceId,
      knowledgeBaseIds: [kbId],
      topK: input.topK ?? 5,
      scoreThreshold: input.scoreThreshold ?? 0.5,
      metadataFilters: input.metadataFilters,
    });
    return { query: input.query, total: hits.length, hits };
  }

  async attachToAgent(
    ctx: WorkspaceContext,
    agentId: string,
    input: { knowledgeBaseId: string; retrievalConfig?: Record<string, any>; isEnabled?: boolean }
  ) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    if (agent.visibility === 'PERSONAL' && agent.ownerUserId !== ctx.userId) {
      throw new ForbiddenError('Only the owner can modify a personal agent');
    }

    await this.getKnowledgeBaseById(ctx, input.knowledgeBaseId);

    const existing = await prisma.agentKnowledgeBase.findFirst({
      where: { agentId, agentVersionId: null, knowledgeBaseId: input.knowledgeBaseId },
    });

    if (existing) {
      return prisma.agentKnowledgeBase.update({
        where: { id: existing.id },
        data: {
          retrievalConfig: input.retrievalConfig ?? undefined,
          isEnabled: input.isEnabled ?? true,
        },
        include: { knowledgeBase: true },
      });
    }

    return prisma.agentKnowledgeBase.create({
      data: {
        agentId,
        knowledgeBaseId: input.knowledgeBaseId,
        retrievalConfig: input.retrievalConfig ?? { topK: 5, scoreThreshold: 0.5 },
        isEnabled: input.isEnabled ?? true,
      },
      include: { knowledgeBase: true },
    });
  }

  async detachFromAgent(ctx: WorkspaceContext, agentId: string, kbId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.workspaceId !== ctx.workspaceId) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    await prisma.agentKnowledgeBase.deleteMany({
      where: { agentId, agentVersionId: null, knowledgeBaseId: kbId },
    });
    return true;
  }

  async listAgentKnowledgeBases(ctx: WorkspaceContext, agentId: string) {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || (!agent.isSystem && agent.workspaceId !== ctx.workspaceId)) {
      throw new NotFoundError(`Agent '${agentId}' not found`);
    }
    return prisma.agentKnowledgeBase.findMany({
      where: { agentId, agentVersionId: null },
      include: { knowledgeBase: true },
    });
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
export default knowledgeBaseService;
