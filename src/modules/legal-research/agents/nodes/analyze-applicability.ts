import applicabilityService from '../../reasoning/applicability.service';
import conflictResolutionService from '../../reasoning/conflict-resolution.service';
import temporalAnalysisService from '../../reasoning/temporal-analysis.service';
import { LegalResearchStateType } from '../legal-research.state';
import { LEGAL_RESEARCH_CONFIG } from '../legal-research.config';

export async function analyzeApplicabilityNode(
  state: LegalResearchStateType
): Promise<Partial<LegalResearchStateType>> {
  const temporal = temporalAnalysisService.analyzeTemporalApplicability(
    state.eventDate,
    state.canonicalEvidence
  );

  const applicability = applicabilityService.filterAndAssess({
    evidence: state.canonicalEvidence,
    jurisdiction: state.jurisdiction,
    temporal,
  });

  const { ordered, conflictNotes } =
    conflictResolutionService.prioritizeAndDetectConflicts(
      applicability.applicableEvidence
    );

  const evidenceSufficient =
    ordered.length >= LEGAL_RESEARCH_CONFIG.minEvidenceCountForSynthesis;

  const applicableLaws = ordered.map((ev) => ({
    documentId: ev.documentId,
    title: ev.documentTitle,
    provisionId: ev.provisionId,
    provisionNumber: ev.provisionNumber,
    exactText: ev.exactText,
    effectiveFrom: ev.effectiveFrom ?? undefined,
    effectiveUntil: ev.effectiveUntil ?? undefined,
    sourceAuthority: ev.sourceAuthority,
    sourceUrl: ev.sourceUrl,
    verificationStatus: ev.verificationStatus,
  }));

  return {
    canonicalEvidence: ordered,
    applicableLaws,
    evidenceSufficient,
    facts: {
      ...state.facts,
      applicabilityNotes: [...applicability.notes, ...conflictNotes],
      excludedEvidence: applicability.excludedEvidence,
    },
  };
}
