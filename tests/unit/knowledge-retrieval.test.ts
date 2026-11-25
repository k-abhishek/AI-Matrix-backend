import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QdrantService } from '../../src/services/qdrant.service';
import { KnowledgeRetrievalService } from '../../src/modules/knowledge/knowledge-retrieval.service';
import prisma from '../../src/lib/prisma';
import qdrantService from '../../src/services/qdrant.service';
import { ForbiddenError } from '../../src/lib/errors';

vi.mock('../../src/lib/prisma', () => ({
  default: {
    knowledgeBase: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

describe('Knowledge Multi-Tenancy & Qdrant Filter Tests (Step 2)', () => {
  let retrieval: KnowledgeRetrievalService;

  beforeEach(() => {
    vi.clearAllMocks();
    retrieval = new KnowledgeRetrievalService();
  });

  it('buildTenantFilter enforces ACTIVE status, workspaceId, and explicit platform KB IDs', () => {
    const svc = new QdrantService();
    const filter = svc.buildTenantFilter({
      workspaceId: 'org_1',
      workspaceKbIds: ['kb_ws_1'],
      platformKbIds: ['kb_plat_1'],
    });

    expect(filter.must).toEqual(
      expect.arrayContaining([
        { key: 'status', match: { value: 'ACTIVE' } },
        { key: 'knowledgeBaseId', match: { any: ['kb_ws_1', 'kb_plat_1'] } },
      ])
    );
    expect(filter.should).toHaveLength(2);
  });

  it('returns empty results without calling Qdrant when knowledgeBaseIds is empty', async () => {
    const spy = vi.spyOn(qdrantService, 'similaritySearchWithScoreAcrossCollections');
    const res = await retrieval.retrieve({
      query: 'test',
      workspaceId: 'org_1',
      knowledgeBaseIds: [],
    });

    expect(res).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks testKnowledgeBaseRetrieval for another workspace KB', async () => {
    vi.mocked(prisma.knowledgeBase.findUnique).mockResolvedValue({
      id: 'kb-other',
      scope: 'WORKSPACE',
      workspaceId: 'org_2',
      status: 'ACTIVE',
    } as any);

    await expect(
      retrieval.testKnowledgeBaseRetrieval('kb-other', 'org_1', 'secret')
    ).rejects.toThrow(ForbiddenError);
  });
});
