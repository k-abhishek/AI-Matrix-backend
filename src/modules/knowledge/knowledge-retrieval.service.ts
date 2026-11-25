import prisma from '../../lib/prisma';
import qdrantService from '../../services/qdrant.service';
import { ForbiddenError, NotFoundError } from '../../lib/errors';

export interface ScopedRetrievalInput {
  query: string;
  workspaceId: string;
  knowledgeBaseIds: string[];
  topK?: number;
  scoreThreshold?: number;
  metadataFilters?: Record<string, any>;
}

export interface RetrievedKnowledgeChunk {
  index: number;
  knowledgeBaseId?: string;
  documentId?: string;
  pageId?: string;
  crawlerId?: string;
  title?: string;
  url?: string;
  content: string;
  score: number;
}

export class KnowledgeRetrievalService {
  /**
   * Executes tenant-isolated semantic retrieval strictly scoped to the authorized
   * KnowledgeBases and caller's workspaceId.
   */
  async retrieve(input: ScopedRetrievalInput): Promise<RetrievedKnowledgeChunk[]> {
    const {
      query,
      workspaceId,
      knowledgeBaseIds,
      topK = 5,
      scoreThreshold = 0.5,
      metadataFilters,
    } = input;

    if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) {
      return [];
    }

    // Verify all requested KBs are ACTIVE and accessible to this workspace
    const kbs = await prisma.knowledgeBase.findMany({
      where: {
        id: { in: knowledgeBaseIds },
        status: 'ACTIVE',
        OR: [
          { scope: 'WORKSPACE', workspaceId },
          { scope: 'PLATFORM' },
        ],
      },
    });

    if (kbs.length === 0) {
      return [];
    }

    const workspaceKbIds = kbs.filter((kb) => kb.scope === 'WORKSPACE').map((kb) => kb.id);
    const platformKbIds = kbs.filter((kb) => kb.scope === 'PLATFORM').map((kb) => kb.id);
    const collections = [...new Set(kbs.map((kb) => kb.qdrantCollection))];

    const filter = qdrantService.buildTenantFilter({
      workspaceId,
      workspaceKbIds,
      platformKbIds,
      metadataFilters,
    });

    const scored = await qdrantService.similaritySearchWithScoreAcrossCollections(
      query.trim(),
      Math.min(50, Math.max(1, topK)),
      collections,
      filter
    );

    return scored
      .filter(([, score]) => score >= scoreThreshold)
      .slice(0, topK)
      .map(([doc, score], i) => {
        const meta = (doc.metadata || {}) as Record<string, any>;
        return {
          index: i + 1,
          knowledgeBaseId: meta.knowledgeBaseId,
          documentId: meta.documentId,
          pageId: meta.pageId,
          crawlerId: meta.crawlerId,
          title: meta.title,
          url: meta.url,
          content: doc.pageContent,
          score: Number(score.toFixed(4)),
        };
      });
  }

  /**
   * Tests retrieval directly against a single KnowledgeBase with tenant verification.
   */
  async testKnowledgeBaseRetrieval(
    kbId: string,
    workspaceId: string,
    query: string,
    options?: { topK?: number; scoreThreshold?: number; metadataFilters?: Record<string, any> }
  ) {
    const kb = await prisma.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb) {
      throw new NotFoundError(`Knowledge base '${kbId}' not found`);
    }
    if (kb.scope === 'WORKSPACE' && kb.workspaceId !== workspaceId) {
      throw new ForbiddenError('Knowledge base does not belong to this workspace');
    }
    if (kb.status !== 'ACTIVE') {
      throw new ForbiddenError(`Knowledge base '${kbId}' is not active`);
    }

    return this.retrieve({
      query,
      workspaceId,
      knowledgeBaseIds: [kb.id],
      topK: options?.topK ?? 5,
      scoreThreshold: options?.scoreThreshold ?? 0.5,
      metadataFilters: options?.metadataFilters,
    });
  }
}

export const knowledgeRetrievalService = new KnowledgeRetrievalService();
export default knowledgeRetrievalService;
