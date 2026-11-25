import { z } from 'zod';

export const LegalDomainEnum = z.enum([
  'CONSTITUTIONAL',
  'CRIMINAL',
  'CIVIL',
  'CORPORATE_COMMERCIAL',
  'LABOUR_EMPLOYMENT',
  'FAMILY',
  'TAXATION',
  'CONSUMER_PROTECTION',
  'PROPERTY_REAL_ESTATE',
  'CYBER_TECHNOLOGY',
  'BANKING_FINANCIAL',
  'ADMINISTRATIVE_REGULATORY',
  'INTELLECTUAL_PROPERTY',
  'ENVIRONMENTAL',
  'STATE_LEGISLATION',
]);

export type LegalDomainType = z.infer<typeof LegalDomainEnum>;

export const LegalDocumentTypeEnum = z.enum([
  'CONSTITUTION',
  'CENTRAL_ACT',
  'STATE_ACT',
  'AMENDMENT_ACT',
  'RULE',
  'REGULATION',
  'NOTIFICATION',
  'CIRCULAR',
  'ORDINANCE',
  'SUPREME_COURT_JUDGMENT',
  'HIGH_COURT_JUDGMENT',
  'TRIBUNAL_DECISION',
]);

export type LegalDocumentTypeValue = z.infer<typeof LegalDocumentTypeEnum>;

export const LegalVectorPayloadSchema = z.object({
  documentId: z.string(),
  provisionId: z.string(),
  provisionVersionId: z.string(),
  chunkId: z.string(),
  jurisdiction: z.string(),
  state: z.string().optional(),
  legalDomain: z.string(),
  documentType: z.string(),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  court: z.string().optional(),
  judgmentDate: z.string().optional(),
  verificationStatus: z.string(),
});

export type LegalVectorPayload = z.infer<typeof LegalVectorPayloadSchema>;

export interface RetrievedLegalChunk {
  chunkId: string;
  documentId: string;
  provisionId: string;
  provisionVersionId: string;
  score: number;
  source: 'EXACT' | 'KEYWORD' | 'VECTOR' | 'HYBRID';
  metadata: Partial<LegalVectorPayload>;
}

export interface LegalRetrievalOptions {
  eventDate?: Date;
  jurisdiction?: string;
  state?: string;
  legalDomain?: string;
  documentType?: string;
  requireVerifiedSource?: boolean;
  includeHistorical?: boolean;
}

export interface CanonicalLegalEvidence {
  evidenceId: string;
  documentId: string;
  documentTitle: string;
  shortTitle?: string | null;
  documentType: string;
  legalDomain: string;
  jurisdiction: string;
  state?: string | null;
  provisionId: string;
  provisionVersionId: string;
  provisionType: string;
  provisionNumber: string;
  heading?: string | null;
  hierarchyPath: string;
  exactText: string;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  status: string;
  commencementUncertain: boolean;
  uncertaintyNote?: string | null;
  sourceAuthority: string;
  authorityTier: string;
  sourceUrl: string;
  verificationStatus: string;
  score: number;
}
