import { CanonicalLegalEvidence } from './legal-query.schema';
import {
  ApplicableLaw,
  CaseLawFinding,
  LegalFinding,
  LegalResearchResponse,
} from './legal-response.schema';

export interface AmendmentFinding {
  amendingDocumentId: string;
  amendingTitle: string;
  targetDocumentId: string;
  targetProvisionId?: string | null;
  amendmentType: string;
  effectiveDate?: string | null;
  description: string;
}

export interface CitationValidationResult {
  evidenceId: string;
  documentId: string;
  provisionId?: string;
  caseId?: string;
  valid: boolean;
  reason?: string;
}

export interface LegalJurisdictionInfo {
  country: string;
  state?: string;
  level: 'CENTRAL' | 'STATE' | 'CONCURRENT' | 'UNKNOWN';
  ambiguous?: boolean;
}

export interface LegalResearchInput {
  userQuery: string;
  contextFacts?: Record<string, unknown>;
  jurisdictionHint?: string;
  stateHint?: string;
  eventDateHint?: string;
  maxIterations?: number;
}

export interface LegalResearchStateSnapshot {
  userQuery: string;
  domain?: string;
  facts: Record<string, unknown>;
  missingInformation: string[];
  jurisdiction: LegalJurisdictionInfo;
  eventDate?: string;
  searchQueries: string[];
  retrievedChunkIds: string[];
  canonicalEvidence: CanonicalLegalEvidence[];
  applicableLaws: ApplicableLaw[];
  legalFindings: LegalFinding[];
  caseLaw: CaseLawFinding[];
  amendmentFindings: AmendmentFinding[];
  legalIssues: string[];
  evidenceSufficient: boolean;
  citationValidationResults: CitationValidationResult[];
  finalFindings?: LegalResearchResponse;
  iterationCount: number;
  maxIterations: number;
  errors: string[];
}
