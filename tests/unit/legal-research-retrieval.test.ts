import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exactLegalSearchService } from '../../src/modules/legal-research/retrieval/exact-search.service';
import { legalRerankerService } from '../../src/modules/legal-research/retrieval/reranker.service';
import { hydrateLegalEvidence } from '../../src/modules/legal-research/retrieval/canonical-hydration.service';
import legalProvisionRepository from '../../src/modules/legal-research/knowledge/legal-provision.repository';
import legalVersionRepository from '../../src/modules/legal-research/knowledge/legal-version.repository';
import { RetrievedLegalChunk } from '../../src/modules/legal-research/schemas/legal-query.schema';

describe('Indian Legal Research - Retrieval & Canonical Hydration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses constitutional articles, statutory sections, and case citations', () => {
    const refs = exactLegalSearchService.parseReferences(
      'What does Article 21 of the Constitution and Section 420 IPC say? See (2020) 5 SCC 123.'
    );
    expect(refs.provisionNumbers).toContain('Article 21');
    expect(refs.provisionNumbers).toContain('Section 420');
    expect(refs.caseCitations).toContain('(2020) 5 SCC 123');
  });

  it('fuses and reranks exact, keyword, and vector results favoring exact matches', () => {
    const exact: RetrievedLegalChunk[] = [
      {
        chunkId: 'c1',
        documentId: 'doc-1',
        provisionId: 'prov-1',
        provisionVersionId: 'pv-1',
        score: 1.0,
        source: 'EXACT',
        metadata: {},
      },
    ];
    const vector: RetrievedLegalChunk[] = [
      {
        chunkId: 'c2',
        documentId: 'doc-2',
        provisionId: 'prov-2',
        provisionVersionId: 'pv-2',
        score: 0.92,
        source: 'VECTOR',
        metadata: {},
      },
      {
        chunkId: 'c1',
        documentId: 'doc-1',
        provisionId: 'prov-1',
        provisionVersionId: 'pv-1',
        score: 0.85,
        source: 'VECTOR',
        metadata: {},
      },
    ];

    const fused = legalRerankerService.fuseAndRerank([exact, vector], 5);
    expect(fused[0].provisionId).toBe('prov-1');
    expect(fused[0].source).toBe('HYBRID');
  });

  it('hydrates canonical text from PostgreSQL and rejects invalid/mismatched IDs', async () => {
    vi.spyOn(legalProvisionRepository, 'findProvisionVersionsByIds').mockResolvedValue([
      {
        id: 'pv-valid',
        provisionId: 'prov-valid',
        exactText: 'Canonical text from PostgreSQL for Article 21.',
        effectiveFrom: new Date('1950-01-26'),
        effectiveUntil: null,
        status: 'ACTIVE',
        commencementUncertain: false,
        uncertaintyNote: null,
        provision: {
          id: 'prov-valid',
          documentId: 'doc-valid',
          provisionType: 'ARTICLE',
          provisionNumber: 'Article 21',
          heading: 'Protection of life and personal liberty',
          hierarchyPath: 'Part III/Article 21',
          document: {
            id: 'doc-valid',
            title: 'Constitution of India',
            shortTitle: 'Constitution',
            documentType: 'CONSTITUTION',
            legalDomain: 'CONSTITUTIONAL',
            jurisdiction: 'IN',
            state: null,
            sourceUrl: 'https://www.indiacode.nic.in/',
            verificationStatus: 'VERIFIED',
            source: {
              name: 'India Code',
              authorityTier: 'PRIMARY_LEGISLATION',
            },
          },
        },
      } as any,
    ]);

    const chunks: RetrievedLegalChunk[] = [
      // Valid
      {
        chunkId: 'chunk-1',
        documentId: 'doc-valid',
        provisionId: 'prov-valid',
        provisionVersionId: 'pv-valid',
        score: 0.9,
        source: 'VECTOR',
        metadata: { documentId: 'doc-valid' },
      },
      // Mismatched documentId -> must be rejected
      {
        chunkId: 'chunk-2',
        documentId: 'doc-wrong',
        provisionId: 'prov-valid',
        provisionVersionId: 'pv-valid',
        score: 0.99,
        source: 'VECTOR',
        metadata: {},
      },
      // Missing/non-existent versionId -> must be rejected
      {
        chunkId: 'chunk-3',
        documentId: 'doc-valid',
        provisionId: 'prov-valid',
        provisionVersionId: 'pv-missing',
        score: 0.95,
        source: 'VECTOR',
        metadata: {},
      },
    ];

    const hydrated = await hydrateLegalEvidence(chunks);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].exactText).toBe('Canonical text from PostgreSQL for Article 21.');
    expect(hydrated[0].sourceAuthority).toBe('India Code');
  });

  it('resolves historical provision version as of eventDate', async () => {
    vi.spyOn(legalProvisionRepository, 'findProvisionVersionsByIds').mockResolvedValue([
      {
        id: 'pv-current',
        provisionId: 'prov-1',
        exactText: 'Current text (2024)',
        effectiveFrom: new Date('2024-07-01'),
        effectiveUntil: null,
        status: 'ACTIVE',
        commencementUncertain: false,
        provision: {
          id: 'prov-1',
          documentId: 'doc-1',
          provisionType: 'SECTION',
          provisionNumber: 'Section 420',
          heading: 'Cheating',
          hierarchyPath: 'Section 420',
          document: {
            id: 'doc-1',
            title: 'Indian Penal Code, 1860',
            documentType: 'CENTRAL_ACT',
            legalDomain: 'CRIMINAL',
            jurisdiction: 'IN',
            state: null,
            sourceUrl: 'https://www.indiacode.nic.in/',
            verificationStatus: 'VERIFIED',
            source: { name: 'India Code', authorityTier: 'PRIMARY_LEGISLATION' },
          },
        },
      } as any,
    ]);

    vi.spyOn(legalVersionRepository, 'getProvisionAsOfDate').mockResolvedValue({
      id: 'pv-historical-2022',
      provisionId: 'prov-1',
      exactText: 'Historical 2022 IPC Section 420 text',
      effectiveFrom: new Date('1862-01-01'),
      effectiveUntil: new Date('2024-07-01'),
      status: 'REPEALED',
      commencementUncertain: false,
      provision: {
        id: 'prov-1',
        documentId: 'doc-1',
        provisionType: 'SECTION',
        provisionNumber: 'Section 420',
        heading: 'Cheating',
        hierarchyPath: 'Section 420',
        document: {
          id: 'doc-1',
          title: 'Indian Penal Code, 1860',
          documentType: 'CENTRAL_ACT',
          legalDomain: 'CRIMINAL',
          jurisdiction: 'IN',
          state: null,
          sourceUrl: 'https://www.indiacode.nic.in/',
          verificationStatus: 'VERIFIED',
          source: { name: 'India Code', authorityTier: 'PRIMARY_LEGISLATION' },
        },
      },
    } as any);

    const hydrated = await hydrateLegalEvidence(
      [
        {
          chunkId: 'c1',
          documentId: 'doc-1',
          provisionId: 'prov-1',
          provisionVersionId: 'pv-current',
          score: 0.9,
          source: 'VECTOR',
          metadata: {},
        },
      ],
      { eventDate: new Date('2022-05-15') }
    );

    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].provisionVersionId).toBe('pv-historical-2022');
    expect(hydrated[0].exactText).toBe('Historical 2022 IPC Section 420 text');
  });
});
