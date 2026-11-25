import jurisdictionService from '../../reasoning/jurisdiction.service';
import { LegalResearchStateType } from '../legal-research.state';

export async function determineJurisdictionNode(
  state: LegalResearchStateType
): Promise<Partial<LegalResearchStateType>> {
  const jurisdiction = jurisdictionService.detectJurisdiction(
    state.userQuery,
    state.domain,
    state.jurisdiction?.state
  );

  const missing = [...state.missingInformation];
  if (jurisdiction.ambiguous && !missing.some((m) => m.toLowerCase().includes('state'))) {
    missing.push('Applicable Indian State/Union Territory (for state-specific rules)');
  }

  return {
    jurisdiction,
    missingInformation: missing,
  };
}
