import { z } from 'zod';

export const LegalFindingSchema = z.object({
  issue: z.string(),
  conclusion: z.string(),
  reasoning: z.string(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  evidenceIds: z.array(z.string()),
});

export const ApplicableLawSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  provisionId: z.string(),
  provisionNumber: z.string(),
  exactText: z.string(),
  effectiveFrom: z.string().optional(),
  effectiveUntil: z.string().optional(),
  sourceAuthority: z.string(),
  sourceUrl: z.string(),
  verificationStatus: z.string(),
});

export const CaseLawFindingSchema = z.object({
  caseId: z.string(),
  caseName: z.string(),
  court: z.string(),
  judgmentDate: z.string(),
  citation: z.string().optional(),
  paragraphReferences: z.array(z.string()),
  sourceUrl: z.string(),
  relevance: z.string(),
});

export const LegalResearchResponseSchema = z.object({
  status: z.enum([
    'COMPLETED',
    'NEEDS_CLARIFICATION',
    'INSUFFICIENT_EVIDENCE',
    'FAILED',
  ]),
  domain: z.string(),
  jurisdiction: z.object({
    country: z.string(),
    state: z.string().optional(),
    level: z.string(),
  }),
  eventDate: z.string().optional(),
  asOfDate: z.string(),
  summary: z.string(),
  legalFindings: z.array(LegalFindingSchema),
  applicableLaws: z.array(ApplicableLawSchema),
  caseLaw: z.array(CaseLawFindingSchema),
  recommendedActions: z.array(z.string()),
  missingInformation: z.array(z.string()),
  risks: z.array(z.string()),
  limitations: z.array(z.string()),
  sourcesVerified: z.boolean(),
  requiresLawyer: z.boolean(),
});

export type LegalResearchResponse = z.infer<typeof LegalResearchResponseSchema>;
export type LegalFinding = z.infer<typeof LegalFindingSchema>;
export type ApplicableLaw = z.infer<typeof ApplicableLawSchema>;
export type CaseLawFinding = z.infer<typeof CaseLawFindingSchema>;
