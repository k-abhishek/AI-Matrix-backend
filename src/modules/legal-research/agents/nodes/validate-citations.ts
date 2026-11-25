import citationValidator from '../../verification/citation-validator';
import claimValidator from '../../verification/claim-validator';
import { LegalResearchStateType } from '../legal-research.state';
import { LegalResearchResponseSchema } from '../../schemas/legal-response.schema';

export async function validateCitationsNode(
  state: LegalResearchStateType
): Promise<Partial<LegalResearchStateType>> {
  const validationResults = await Promise.all(
    state.canonicalEvidence.map((ev) =>
      citationValidator.verifyStatutoryCitation({
        documentId: ev.documentId,
        provisionId: ev.provisionId,
        provisionVersionId: ev.provisionVersionId,
      })
    )
  );

  for (const c of state.caseLaw) {
    const res = await citationValidator.verifyJudicialCitation({
      caseId: c.caseId,
      paragraphReferences: c.paragraphReferences,
    });
    validationResults.push(res);
  }

  const validEvidenceIds = new Set(
    validationResults.filter((r) => r.valid).map((r) => r.evidenceId)
  );

  const verifiedLaws = state.applicableLaws.filter((law) =>
    state.canonicalEvidence.some(
      (ev) =>
        ev.documentId === law.documentId &&
        ev.provisionId === law.provisionId &&
        validEvidenceIds.has(ev.evidenceId)
    )
  );

  const { validatedFindings, sourcesVerified, requiresLawyer } =
    claimValidator.validateClaims({
      findings: state.legalFindings,
      evidence: state.canonicalEvidence,
      validationResults,
      domain: state.domain || 'CIVIL',
    });

  const synthesizedSummary =
    typeof state.facts?.synthesizedSummary === 'string' && state.facts.synthesizedSummary.trim()
      ? state.facts.synthesizedSummary
      : verifiedLaws.length > 0
        ? `Retrieved ${verifiedLaws.length} verified statutory provision(s) for ${state.domain || 'Indian Law'}.`
        : 'No verified statutory provisions matching the query were found in the indexed knowledge base.';

  const status =
    state.needsClarification && verifiedLaws.length === 0
      ? 'NEEDS_CLARIFICATION'
      : verifiedLaws.length === 0 && state.caseLaw.length === 0
        ? 'INSUFFICIENT_EVIDENCE'
        : 'COMPLETED';

  const response = LegalResearchResponseSchema.parse({
    status,
    domain: state.domain || 'CIVIL',
    jurisdiction: {
      country: state.jurisdiction?.country || 'IN',
      state: state.jurisdiction?.state,
      level: state.jurisdiction?.level || 'CENTRAL',
    },
    eventDate: state.eventDate,
    asOfDate: new Date().toISOString().slice(0, 10),
    summary: synthesizedSummary,
    legalFindings: validatedFindings,
    applicableLaws: verifiedLaws,
    caseLaw: state.caseLaw,
    recommendedActions: Array.isArray(state.facts?.recommendedActions)
      ? (state.facts.recommendedActions as string[])
      : requiresLawyer
        ? ['Consult a qualified Indian legal practitioner for case-specific advice.']
        : [],
    missingInformation: state.missingInformation,
    risks: Array.isArray(state.facts?.risks) ? (state.facts.risks as string[]) : [],
    limitations: [
      ...(Array.isArray(state.facts?.limitations) ? (state.facts.limitations as string[]) : []),
      ...(Array.isArray(state.facts?.applicabilityNotes)
        ? (state.facts.applicabilityNotes as string[])
        : []),
      'This research output is informational and does not constitute formal legal advice.',
    ],
    sourcesVerified,
    requiresLawyer,
  });

  return {
    citationValidationResults: validationResults,
    applicableLaws: verifiedLaws,
    legalFindings: validatedFindings,
    finalFindings: response,
  };
}
