import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../src/lib/prisma';
import { citationValidator } from '../../src/modules/legal-research/verification/citation-validator';
import { claimValidator } from '../../src/modules/legal-research/verification/claim-validator';
import hybridLegalSearchService from '../../src/modules/legal-research/retrieval/hybrid-search.service';
import legalCaseRepository from '../../src/modules/legal-research/knowledge/legal-case.repository';
import legalVersionRepository from '../../src/modules/legal-research/knowledge/legal-version.repository';
import legalRelationshipRepository from '../../src/modules/legal-research/knowledge/legal-relationship.repository';
import { runIndianLegalResearch, LegalResearchResponseSchema } from '../../src/modules/legal-research';
import capabilityResolverService from '../../src/modules/capabilities/capability-resolver.service';
import agentService from '../../src/modules/agents/agent.service';
import { ForbiddenError } from '../../src/lib/errors';

describe('Indian Legal Research - Verification, Agent Graph & Aggregator Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects fabricated statutory and judicial citations', async () => {
    vi.spyOn(prisma.legalDocument, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.legalJudgment, 'findUnique').mockResolvedValue(null);

    const statRes = await citationValidator.verifyStatutoryCitation({
      documentId: 'non-existent-doc',
      provisionId: 'non-existent-prov',
    });
    expect(statRes.valid).toBe(false);

    const caseRes = await citationValidator.verifyJudicialCitation({
      caseId: 'non-existent-case',
    });
    expect(caseRes.valid).toBe(false);
  });

  it('rejects out-of-range paragraph references on verified judgments', async () => {
    vi.spyOn(prisma.legalJudgment, 'findUnique').mockResolvedValue({
      id: 'case-1',
      documentId: 'doc-case-1',
      paragraphCount: 25,
      verificationStatus: 'VERIFIED',
    } as any);

    const res = await citationValidator.verifyJudicialCitation({
      caseId: 'case-1',
      paragraphReferences: ['para 99'],
    });
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('exceeds judgment paragraphCount');
  });

  it('completes end-to-end LangGraph research workflow and returns validated LegalResearchResponse', async () => {
    vi.spyOn(hybridLegalSearchService, 'searchAndHydrate').mockResolvedValue([
      {
        evidenceId: 'ev_pv-art21',
        documentId: 'doc-const',
        documentTitle: 'Constitution of India',
        shortTitle: 'Constitution',
        documentType: 'CONSTITUTION',
        legalDomain: 'CONSTITUTIONAL',
        jurisdiction: 'IN',
        state: null,
        provisionId: 'prov-art21',
        provisionVersionId: 'pv-art21',
        provisionType: 'ARTICLE',
        provisionNumber: 'Article 21',
        heading: 'Protection of life and personal liberty',
        hierarchyPath: 'Part III/Article 21',
        exactText:
          'No person shall be deprived of his life or personal liberty except according to procedure established by law.',
        effectiveFrom: '1950-01-26T00:00:00.000Z',
        effectiveUntil: null,
        status: 'ACTIVE',
        commencementUncertain: false,
        uncertaintyNote: null,
        sourceAuthority: 'India Code',
        authorityTier: 'PRIMARY_LEGISLATION',
        sourceUrl: 'https://www.indiacode.nic.in/handle/123456789/15240',
        verificationStatus: 'VERIFIED',
        score: 0.99,
      },
    ]);

    vi.spyOn(legalCaseRepository, 'searchCaseLaw').mockResolvedValue([]);
    vi.spyOn(legalVersionRepository, 'getDocumentAmendments').mockResolvedValue([]);
    vi.spyOn(legalRelationshipRepository, 'findRelatedAuthorities').mockResolvedValue({
      relationships: [],
      citations: [],
    });

    vi.spyOn(prisma.legalDocument, 'findUnique').mockResolvedValue({
      id: 'doc-const',
      verificationStatus: 'VERIFIED',
      source: { name: 'India Code' },
    } as any);
    vi.spyOn(prisma.legalProvision, 'findUnique').mockResolvedValue({
      id: 'prov-art21',
      documentId: 'doc-const',
    } as any);
    vi.spyOn(prisma.legalProvisionVersion, 'findUnique').mockResolvedValue({
      id: 'pv-art21',
      provisionId: 'prov-art21',
    } as any);

    const result = await runIndianLegalResearch({
      userQuery: 'What does Article 21 of the Indian Constitution protect?',
    });

    const parsed = LegalResearchResponseSchema.parse(result);
    expect(parsed.status).toBe('COMPLETED');
    expect(parsed.domain).toBe('CONSTITUTIONAL');
    expect(parsed.sourcesVerified).toBe(true);
    expect(parsed.applicableLaws[0].provisionNumber).toBe('Article 21');
  });

  it('returns INSUFFICIENT_EVIDENCE without fabricating citations when KB has no matches', async () => {
    vi.spyOn(hybridLegalSearchService, 'searchAndHydrate').mockResolvedValue([]);
    vi.spyOn(legalCaseRepository, 'searchCaseLaw').mockResolvedValue([]);

    const result = await runIndianLegalResearch({
      userQuery: 'What is the penalty under a non-existent statute?',
      maxIterations: 1,
    });

    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.applicableLaws).toHaveLength(0);
    expect(result.sourcesVerified).toBe(false);
    expect(result.requiresLawyer).toBe(true);
  });

  it('resolves indian_legal_research via CapabilityResolverService BUILTIN grant', async () => {
    vi.spyOn(prisma.agentToolGrant, 'findMany').mockResolvedValue([
      {
        id: 'grant-1',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        capabilityType: 'BUILTIN',
        toolKey: 'indian_legal_research',
        connectionScope: 'WORKSPACE_SHARED',
        requiresApproval: false,
        isEnabled: true,
        allowedToolNames: [],
      } as any,
    ]);

    const { tools } = await capabilityResolverService.resolveAgentGrants(
      { workspaceId: 'ws-1', userId: 'user-1', isOrganization: false },
      'agent-1',
      null
    );

    expect(tools.some((t) => t.toolKey === 'indian_legal_research')).toBe(true);
  });

  it('calibrates claim confidence and requiresLawyer for high-stakes criminal domain', () => {
    const res = claimValidator.validateClaims({
      findings: [
        {
          issue: 'Arrest without warrant',
          conclusion: 'Governed by Section 35 BNSS',
          reasoning: 'Statutory text',
          confidence: 'HIGH',
          evidenceIds: ['ev_1', 'ev_fabricated'],
        },
      ],
      evidence: [{ evidenceId: 'ev_1' } as any],
      validationResults: [{ evidenceId: 'ev_1', documentId: 'd1', valid: true }],
      domain: 'CRIMINAL',
    });

    expect(res.validatedFindings[0].evidenceIds).toEqual(['ev_1']);
    expect(res.validatedFindings[0].confidence).toBe('MEDIUM');
    expect(res.requiresLawyer).toBe(true);
  });

  it('prevents users from deleting or archiving the system Indian Legal Research Agent', async () => {
    vi.spyOn(prisma.agent, 'findUnique').mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000101',
      workspaceId: 'platform',
      ownerUserId: 'system',
      visibility: 'WORKSPACE',
      slug: 'indian-legal-research',
      isSystem: true,
      status: 'ACTIVE',
      versions: [],
    } as any);

    await expect(
      agentService.archiveAgent(
        { workspaceId: 'ws-1', userId: 'user-1', isOrganization: false },
        '00000000-0000-4000-8000-000000000101'
      )
    ).rejects.toThrow(ForbiddenError);
  });
});
