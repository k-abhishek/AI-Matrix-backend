import { LegalResearchStateType } from '../legal-research.state';

export async function generateQueriesNode(
  state: LegalResearchStateType
): Promise<Partial<LegalResearchStateType>> {
  const queries = new Set<string>(state.searchQueries);
  queries.add(state.userQuery.trim());

  if (state.jurisdiction?.state) {
    queries.add(`${state.jurisdiction.state} ${state.userQuery.trim()}`);
  }

  if (state.domain === 'CRIMINAL' && state.facts?.criminalLawRegime === 'IPC_CRPC_IEA') {
    queries.add(`${state.userQuery.trim()} IPC CrPC`);
  }

  return {
    searchQueries: [...queries].slice(0, 4),
  };
}
