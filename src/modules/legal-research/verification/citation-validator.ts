import prisma from '../../../lib/prisma';
import { CitationValidationResult } from '../schemas/legal-state.schema';

export class CitationValidator {
  async verifyStatutoryCitation(params: {
    documentId: string;
    provisionId?: string;
    provisionVersionId?: string;
  }): Promise<CitationValidationResult> {
    const doc = await prisma.legalDocument.findUnique({
      where: { id: params.documentId },
      include: { source: true },
    });

    if (!doc) {
      return {
        evidenceId: params.provisionVersionId ? `ev_${params.provisionVersionId}` : params.documentId,
        documentId: params.documentId,
        provisionId: params.provisionId,
        valid: false,
        reason: `Document '${params.documentId}' not found in canonical database`,
      };
    }

    if (params.provisionId) {
      const prov = await prisma.legalProvision.findUnique({
        where: { id: params.provisionId },
      });
      if (!prov || prov.documentId !== doc.id) {
        return {
          evidenceId: params.provisionVersionId ? `ev_${params.provisionVersionId}` : params.provisionId,
          documentId: params.documentId,
          provisionId: params.provisionId,
          valid: false,
          reason: `Provision '${params.provisionId}' does not belong to document '${params.documentId}'`,
        };
      }
    }

    if (params.provisionVersionId) {
      const pv = await prisma.legalProvisionVersion.findUnique({
        where: { id: params.provisionVersionId },
      });
      if (!pv || (params.provisionId && pv.provisionId !== params.provisionId)) {
        return {
          evidenceId: `ev_${params.provisionVersionId}`,
          documentId: params.documentId,
          provisionId: params.provisionId,
          valid: false,
          reason: `ProvisionVersion '${params.provisionVersionId}' is invalid`,
        };
      }
    }

    const isVerified = doc.verificationStatus === 'VERIFIED';
    return {
      evidenceId: params.provisionVersionId ? `ev_${params.provisionVersionId}` : params.documentId,
      documentId: params.documentId,
      provisionId: params.provisionId,
      valid: isVerified,
      reason: isVerified ? undefined : `Document verificationStatus is '${doc.verificationStatus}'`,
    };
  }

  async verifyJudicialCitation(params: {
    caseId: string;
    paragraphReferences?: string[];
  }): Promise<CitationValidationResult> {
    const judgment = await prisma.legalJudgment.findUnique({
      where: { id: params.caseId },
    });

    if (!judgment) {
      return {
        evidenceId: params.caseId,
        documentId: '',
        caseId: params.caseId,
        valid: false,
        reason: `Case '${params.caseId}' not found in canonical database`,
      };
    }

    if (
      params.paragraphReferences &&
      params.paragraphReferences.length > 0 &&
      judgment.paragraphCount !== null &&
      judgment.paragraphCount !== undefined
    ) {
      for (const ref of params.paragraphReferences) {
        const num = Number.parseInt(ref.replace(/\D/g, ''), 10);
        if (!Number.isNaN(num) && (num < 1 || num > judgment.paragraphCount)) {
          return {
            evidenceId: params.caseId,
            documentId: judgment.documentId,
            caseId: params.caseId,
            valid: false,
            reason: `Paragraph reference '${ref}' exceeds judgment paragraphCount (${judgment.paragraphCount})`,
          };
        }
      }
    }

    return {
      evidenceId: params.caseId,
      documentId: judgment.documentId,
      caseId: params.caseId,
      valid: judgment.verificationStatus === 'VERIFIED',
      reason:
        judgment.verificationStatus === 'VERIFIED'
          ? undefined
          : `Judgment verificationStatus is '${judgment.verificationStatus}'`,
    };
  }
}

export const citationValidator = new CitationValidator();
export default citationValidator;
