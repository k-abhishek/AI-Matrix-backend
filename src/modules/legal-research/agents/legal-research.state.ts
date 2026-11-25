import { Annotation } from '@langchain/langgraph';
import { CanonicalLegalEvidence } from '../schemas/legal-query.schema';
import {
  ApplicableLaw,
  CaseLawFinding,
  LegalFinding,
  LegalResearchResponse,
} from '../schemas/legal-response.schema';
import {
  AmendmentFinding,
  CitationValidationResult,
  LegalJurisdictionInfo,
} from '../schemas/legal-state.schema';

export const LegalResearchGraphState = Annotation.Root({
  userQuery: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => '',
  }),
  domain: Annotation<string | undefined>({
    reducer: (_a, b) => b,
    default: () => undefined,
  }),
  facts: Annotation<Record<string, unknown>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  missingInformation: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  needsClarification: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  jurisdiction: Annotation<LegalJurisdictionInfo>({
    reducer: (_a, b) => b,
    default: () => ({ country: 'IN', level: 'CENTRAL' }),
  }),
  eventDate: Annotation<string | undefined>({
    reducer: (_a, b) => b,
    default: () => undefined,
  }),
  searchQueries: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  retrievedChunkIds: Annotation<string[]>({
    reducer: (a, b) => [...new Set([...a, ...b])],
    default: () => [],
  }),
  canonicalEvidence: Annotation<CanonicalLegalEvidence[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  applicableLaws: Annotation<ApplicableLaw[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  legalFindings: Annotation<LegalFinding[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  caseLaw: Annotation<CaseLawFinding[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  amendmentFindings: Annotation<AmendmentFinding[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  legalIssues: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  evidenceSufficient: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  citationValidationResults: Annotation<CitationValidationResult[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  finalFindings: Annotation<LegalResearchResponse | undefined>({
    reducer: (_a, b) => b,
    default: () => undefined,
  }),
  iterationCount: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  maxIterations: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 2,
  }),
  errors: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type LegalResearchStateType = typeof LegalResearchGraphState.State;
