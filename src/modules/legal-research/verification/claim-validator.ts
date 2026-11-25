import { CanonicalLegalEvidence } from '../schemas/legal-query.schema';
import { LegalFinding } from '../schemas/legal-response.schema';
import { CitationValidationResult } from '../schemas/legal-state.schema';

const HIGH_STAKES_DOMAINS = new Set([
  'CRIMINAL',
  'PROPERTY_REAL_ESTATE',
  'CORPORATE_COMMERCIAL',
  'TAXATION',
  'FAMILY',
]);

export class ClaimValidator {
  validateClaims(params: {
    findings: LegalFinding[];
    evidence: CanonicalLegalEvidence[];
    validationResults: CitationValidationResult[];
    domain: string;
  }): {
    validatedFindings: LegalFinding[];
    sourcesVerified: boolean;
    requiresLawyer: boolean;
  } {
    const validEvidenceIds = new Set(
      params.validationResults.filter((r) => r.valid).map((r) => r.evidenceId)
    );
    const knownEvidenceIds = new Set(params.evidence.map((e) => e.evidenceId));

    const validatedFindings = params.findings.map((f) => {
      const verifiedIds = f.evidenceIds.filter(
        (id) => knownEvidenceIds.has(id) && validEvidenceIds.has(id)
      );
      const confidence =
        verifiedIds.length === 0
          ? ('LOW' as const)
          : verifiedIds.length < f.evidenceIds.length
            ? ('MEDIUM' as const)
            : f.confidence;

      return {
        ...f,
        evidenceIds: verifiedIds,
        confidence,
      };
    });

    const sourcesVerified =
      params.validationResults.length > 0 &&
      params.validationResults.every((r) => r.valid);

    const requiresLawyer =
      HIGH_STAKES_DOMAINS.has(params.domain) || !sourcesVerified;

    return {
      validatedFindings,
      sourcesVerified,
      requiresLawyer,
    };
  }
}

export const claimValidator = new ClaimValidator();
export default claimValidator;
