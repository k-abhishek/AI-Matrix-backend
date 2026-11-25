import { LegalResearchStateType } from '../legal-research.state';

export async function extractFactsNode(
  state: LegalResearchStateType
): Promise<Partial<LegalResearchStateType>> {
  const facts: Record<string, unknown> = { ...state.facts };
  const missing: string[] = [...state.missingInformation];

  const q = state.userQuery.toLowerCase();
  if (q.includes('probation')) facts.employmentStage = 'probation';
  if (q.includes('three months') || q.includes('3 months')) facts.unpaidSalaryMonths = 3;
  if (q.includes('notice')) facts.noticeMentioned = true;
  if (q.includes('warrant')) facts.warrantMentioned = true;

  return {
    facts,
    missingInformation: [...new Set(missing)],
  };
}
