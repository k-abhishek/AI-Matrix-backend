import { describe, it, expect } from 'vitest';
import { temporalAnalysisService } from '../../src/modules/legal-research/reasoning/temporal-analysis.service';
import { jurisdictionService } from '../../src/modules/legal-research/reasoning/jurisdiction.service';
import { applicabilityService } from '../../src/modules/legal-research/reasoning/applicability.service';
import { CanonicalLegalEvidence } from '../../src/modules/legal-research/schemas/legal-query.schema';

const makeEvidence = (overrides: Partial<CanonicalLegalEvidence>): CanonicalLegalEvidence => ({
  evidenceId: 'ev_1',
  documentId: 'doc-1',
  documentTitle: 'Test Act',
  documentType: 'CENTRAL_ACT',
  legalDomain: 'CRIMINAL',
  jurisdiction: 'IN',
  state: null,
  provisionId: 'prov-1',
  provisionVersionId: 'pv-1',
  provisionType: 'SECTION',
  provisionNumber: 'Section 1',
  hierarchyPath: 'Section 1',
  exactText: 'Sample statutory text',
  effectiveFrom: '1862-01-01T00:00:00.000Z',
  effectiveUntil: null,
  status: 'ACTIVE',
  commencementUncertain: false,
  sourceAuthority: 'India Code',
  authorityTier: 'PRIMARY_LEGISLATION',
  sourceUrl: 'https://www.indiacode.nic.in/',
  verificationStatus: 'VERIFIED',
  score: 0.9,
  ...overrides,
});

describe('Indian Legal Research - Temporal & Jurisdiction Analysis', () => {
  it('selects IPC/CrPC/IEA for incidents before 1 July 2024 and BNS/BNSS/BSA on/after', () => {
    const preCutoff = temporalAnalysisService.analyzeTemporalApplicability('2022-08-15', []);
    expect(preCutoff.criminalLawRegime).toBe('IPC_CRPC_IEA');

    const postCutoff = temporalAnalysisService.analyzeTemporalApplicability('2024-07-15', []);
    expect(postCutoff.criminalLawRegime).toBe('BNS_BNSS_BSA');
  });

  it('flags partial commencement and uncertain commencement status', () => {
    const ev = makeEvidence({
      status: 'PARTIAL_COMMENCEMENT',
      commencementUncertain: true,
      uncertaintyNote: 'Section notified only for specific states.',
    });

    const assessment = temporalAnalysisService.analyzeTemporalApplicability('2025-01-01', [ev]);
    expect(assessment.hasUncertainCommencement).toBe(true);
    expect(assessment.notes.some((n) => n.includes('specific states'))).toBe(true);
  });

  it('detects Karnataka state jurisdiction and flags ambiguous state-sensitive queries', () => {
    const karnataka = jurisdictionService.detectJurisdiction(
      'What are my rights as a tenant in Karnataka?',
      'PROPERTY_REAL_ESTATE'
    );
    expect(karnataka.country).toBe('IN');
    expect(karnataka.state).toBe('Karnataka');
    expect(karnataka.ambiguous).toBe(false);

    const ambiguous = jurisdictionService.detectJurisdiction(
      'Can my employer terminate me without notice?',
      'LABOUR_EMPLOYMENT'
    );
    expect(ambiguous.level).toBe('CONCURRENT');
    expect(ambiguous.ambiguous).toBe(true);
  });

  it('filters out state-mismatched and temporally inapplicable provisions', () => {
    const ipc = makeEvidence({
      evidenceId: 'ev_ipc',
      documentTitle: 'Indian Penal Code, 1860',
      effectiveFrom: '1862-01-01T00:00:00.000Z',
      effectiveUntil: '2024-07-01T00:00:00.000Z',
      status: 'REPEALED',
    });
    const bns = makeEvidence({
      evidenceId: 'ev_bns',
      documentTitle: 'Bharatiya Nyaya Sanhita, 2023',
      effectiveFrom: '2024-07-01T00:00:00.000Z',
      effectiveUntil: null,
      status: 'ACTIVE',
    });
    const maharashtraAct = makeEvidence({
      evidenceId: 'ev_mh',
      documentTitle: 'Maharashtra Rent Control Act',
      state: 'Maharashtra',
      effectiveFrom: '2000-03-31T00:00:00.000Z',
    });

    const temporal2022 = temporalAnalysisService.analyzeTemporalApplicability('2022-05-01', [ipc, bns]);
    const res2022 = applicabilityService.filterAndAssess({
      evidence: [ipc, bns, maharashtraAct],
      jurisdiction: { country: 'IN', state: 'Karnataka', level: 'CONCURRENT' },
      temporal: temporal2022,
    });

    expect(res2022.applicableEvidence.map((e) => e.evidenceId)).toEqual(['ev_ipc']);
    expect(res2022.excludedEvidence).toHaveLength(2);
  });
});
