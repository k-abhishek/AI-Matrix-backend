import temporalAnalysisService from '../../reasoning/temporal-analysis.service';
import { LegalResearchStateType } from '../legal-research.state';

export async function temporalAnalysisNode(
  state: LegalResearchStateType
): Promise<Partial<LegalResearchStateType>> {
  const assessment = temporalAnalysisService.analyzeTemporalApplicability(
    state.eventDate,
    state.canonicalEvidence
  );

  return {
    facts: {
      ...state.facts,
      criminalLawRegime: assessment.criminalLawRegime,
      temporalNotes: assessment.notes,
    },
  };
}
