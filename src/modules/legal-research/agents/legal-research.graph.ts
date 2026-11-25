import { END, START, StateGraph } from '@langchain/langgraph';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { LegalResearchGraphState, LegalResearchStateType } from './legal-research.state';
import { LEGAL_RESEARCH_CONFIG } from './legal-research.config';
import { classifyQueryNode } from './nodes/classify-query';
import { extractFactsNode } from './nodes/extract-facts';
import { determineJurisdictionNode } from './nodes/determine-jurisdiction';
import { temporalAnalysisNode } from './nodes/temporal-analysis';
import { generateQueriesNode } from './nodes/generate-queries';
import { analyzeApplicabilityNode } from './nodes/analyze-applicability';
import { synthesizeFindingsNode } from './nodes/synthesize-findings';
import { validateCitationsNode } from './nodes/validate-citations';
import hybridLegalSearchService from '../retrieval/hybrid-search.service';
import legalRelationshipRepository from '../knowledge/legal-relationship.repository';
import legalCaseRepository from '../knowledge/legal-case.repository';
import legalVersionRepository from '../knowledge/legal-version.repository';
import { LegalResearchInput } from '../schemas/legal-state.schema';
import { LegalResearchResponse } from '../schemas/legal-response.schema';

export function buildLegalResearchGraph(model?: BaseChatModel) {
  const graph = new StateGraph(LegalResearchGraphState)
    .addNode('classify_legal_query', (state) => classifyQueryNode(state, model))
    .addNode('extract_legal_facts', (state) => extractFactsNode(state))
    .addNode('determine_jurisdiction', (state) => determineJurisdictionNode(state))
    .addNode('determine_event_date', (state) => temporalAnalysisNode(state))
    .addNode('generate_legal_search_queries', (state) => generateQueriesNode(state))
    .addNode('hybrid_legal_retrieval', async (state) => {
      const eventDate = state.eventDate ? new Date(state.eventDate) : undefined;
      const validEventDate =
        eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate : undefined;

      const evidenceMap = new Map<string, any>();
      const chunkIds: string[] = [];

      for (const q of state.searchQueries.slice(0, 3)) {
        const hydrated = await hybridLegalSearchService.searchAndHydrate(
          q,
          {
            jurisdiction: state.jurisdiction?.country || 'IN',
            state: state.jurisdiction?.state,
            legalDomain: state.iterationCount > 0 ? undefined : state.domain,
            eventDate: validEventDate,
          },
          LEGAL_RESEARCH_CONFIG.defaultRetrievalLimit
        );

        for (const ev of hydrated) {
          chunkIds.push(ev.provisionVersionId);
          if (!evidenceMap.has(ev.provisionId)) {
            evidenceMap.set(ev.provisionId, ev);
          }
        }
      }

      return {
        retrievedChunkIds: chunkIds,
        canonicalEvidence: [...evidenceMap.values()],
        iterationCount: state.iterationCount + 1,
      };
    })
    .addNode('retrieve_related_and_cases', async (state) => {
      const provisionIds = state.canonicalEvidence.map((e) => e.provisionId);
      const docIds = [...new Set(state.canonicalEvidence.map((e) => e.documentId))];

      const cases = await legalCaseRepository.searchCaseLaw({
        query: state.userQuery,
        jurisdiction: state.jurisdiction?.country || 'IN',
        provisionIds: provisionIds.length > 0 ? provisionIds : undefined,
        limit: 5,
      });

      const amendments: any[] = [];
      for (const docId of docIds.slice(0, 3)) {
        const docAmendments = await legalVersionRepository.getDocumentAmendments(docId);
        for (const a of docAmendments) {
          amendments.push({
            amendingDocumentId: a.amendingDocumentId,
            amendingTitle: a.amendingDocument.title,
            targetDocumentId: a.targetDocumentId,
            targetProvisionId: a.targetProvisionId,
            amendmentType: a.amendmentType,
            effectiveDate: a.effectiveDate?.toISOString() ?? null,
            description: a.description,
          });
        }
      }

      for (const pId of provisionIds.slice(0, 3)) {
        await legalRelationshipRepository.findRelatedAuthorities({ provisionId: pId });
      }

      return {
        caseLaw: cases.map((c) => ({
          caseId: c.id,
          caseName: c.caseName,
          court: c.court,
          judgmentDate: c.judgmentDate.toISOString().slice(0, 10),
          citation: c.citation ?? undefined,
          paragraphReferences: [],
          sourceUrl: c.sourceUrl,
          relevance: `Precedent (${c.precedentWeight}) from ${c.court}`,
        })),
        amendmentFindings: amendments,
      };
    })
    .addNode('evaluate_legal_applicability', (state) => analyzeApplicabilityNode(state))
    .addNode('synthesize_legal_findings', (state) => synthesizeFindingsNode(state, model))
    .addNode('validate_legal_citations', (state) => validateCitationsNode(state))
    .addEdge(START, 'classify_legal_query')
    .addEdge('classify_legal_query', 'extract_legal_facts')
    .addEdge('extract_legal_facts', 'determine_jurisdiction')
    .addEdge('determine_jurisdiction', 'determine_event_date')
    .addEdge('determine_event_date', 'generate_legal_search_queries')
    .addEdge('generate_legal_search_queries', 'hybrid_legal_retrieval')
    .addEdge('hybrid_legal_retrieval', 'retrieve_related_and_cases')
    .addEdge('retrieve_related_and_cases', 'evaluate_legal_applicability')
    .addConditionalEdges('evaluate_legal_applicability', (state: LegalResearchStateType) => {
      if (!state.evidenceSufficient && state.iterationCount < state.maxIterations) {
        return 'hybrid_legal_retrieval';
      }
      return 'synthesize_legal_findings';
    })
    .addEdge('synthesize_legal_findings', 'validate_legal_citations')
    .addEdge('validate_legal_citations', END);

  return graph.compile();
}

export async function runIndianLegalResearch(
  input: LegalResearchInput,
  model?: BaseChatModel
): Promise<LegalResearchResponse> {
  const compiled = buildLegalResearchGraph(model);
  const result = await compiled.invoke({
    userQuery: input.userQuery,
    facts: input.contextFacts || {},
    jurisdiction: {
      country: input.jurisdictionHint || 'IN',
      state: input.stateHint,
      level: input.stateHint ? 'STATE' : 'CENTRAL',
    },
    eventDate: input.eventDateHint,
    maxIterations: input.maxIterations ?? LEGAL_RESEARCH_CONFIG.maxResearchIterations,
  });

  if (result.finalFindings) {
    return result.finalFindings;
  }

  return {
    status: 'FAILED',
    domain: result.domain || 'CIVIL',
    jurisdiction: {
      country: result.jurisdiction?.country || 'IN',
      state: result.jurisdiction?.state,
      level: result.jurisdiction?.level || 'CENTRAL',
    },
    eventDate: result.eventDate,
    asOfDate: new Date().toISOString().slice(0, 10),
    summary: 'Legal research workflow failed to produce structured findings.',
    legalFindings: [],
    applicableLaws: [],
    caseLaw: [],
    recommendedActions: [],
    missingInformation: result.missingInformation || [],
    risks: [],
    limitations: ['Workflow execution did not complete normally.'],
    sourcesVerified: false,
    requiresLawyer: true,
  };
}
