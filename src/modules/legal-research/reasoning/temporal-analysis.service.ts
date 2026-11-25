import legalVersionRepository from '../knowledge/legal-version.repository';
import legalDocumentRepository from '../knowledge/legal-document.repository';
import { CanonicalLegalEvidence } from '../schemas/legal-query.schema';
import { LegalDomain } from '@prisma/client';

/**
 * Date on which BNS, BNSS, and BSA replaced IPC, CrPC, and Indian Evidence Act.
 */
export const NEW_CRIMINAL_LAWS_COMMENCEMENT = new Date('2024-07-01T00:00:00.000Z');

export interface TemporalApplicabilityAssessment {
  eventDate?: string;
  asOfDate: string;
  criminalLawRegime: 'IPC_CRPC_IEA' | 'BNS_BNSS_BSA' | 'TRANSITIONAL_OR_UNSPECIFIED';
  notes: string[];
  hasUncertainCommencement: boolean;
}

export class TemporalAnalysisService {
  async getCurrentProvision(provisionId: string) {
    return legalVersionRepository.getCurrentProvision(provisionId);
  }

  async getProvisionAsOfDate(provisionId: string, eventDate: Date) {
    return legalVersionRepository.getProvisionAsOfDate(provisionId, eventDate);
  }

  async getProvisionHistory(provisionId: string) {
    return legalVersionRepository.getProvisionHistory(provisionId);
  }

  async getApplicableLaw(params: {
    jurisdiction: string;
    state?: string;
    eventDate: Date;
    legalDomain: string;
  }) {
    return legalDocumentRepository.findApplicableDocuments({
      jurisdiction: params.jurisdiction,
      state: params.state,
      eventDate: params.eventDate,
      legalDomain: params.legalDomain as LegalDomain,
    });
  }

  /**
   * Determines which criminal law regime applies based on eventDate
   * and flags any temporal or commencement uncertainties in retrieved evidence.
   */
  analyzeTemporalApplicability(
    eventDateStr: string | undefined,
    evidence: CanonicalLegalEvidence[]
  ): TemporalApplicabilityAssessment {
    const asOfDate = new Date().toISOString().slice(0, 10);
    const notes: string[] = [];
    let criminalLawRegime: TemporalApplicabilityAssessment['criminalLawRegime'] =
      'TRANSITIONAL_OR_UNSPECIFIED';
    let hasUncertainCommencement = false;

    if (eventDateStr) {
      const parsed = new Date(eventDateStr);
      if (!Number.isNaN(parsed.getTime())) {
        if (parsed < NEW_CRIMINAL_LAWS_COMMENCEMENT) {
          criminalLawRegime = 'IPC_CRPC_IEA';
          notes.push(
            `Event date (${eventDateStr}) precedes 1 July 2024; substantive criminal liability and saved proceedings are governed by IPC 1860, CrPC 1973, and Indian Evidence Act 1872.`
          );
        } else {
          criminalLawRegime = 'BNS_BNSS_BSA';
          notes.push(
            `Event date (${eventDateStr}) is on or after 1 July 2024; governed by BNS 2023, BNSS 2023, and BSA 2023.`
          );
        }
      }
    }

    for (const ev of evidence) {
      if (ev.commencementUncertain) {
        hasUncertainCommencement = true;
        notes.push(
          ev.uncertaintyNote ||
            `Commencement/current status of ${ev.documentTitle} (${ev.provisionNumber}) is flagged as uncertain.`
        );
      }
      if (ev.status === 'REPEALED' && (!eventDateStr || new Date(eventDateStr) >= NEW_CRIMINAL_LAWS_COMMENCEMENT)) {
        notes.push(
          `${ev.documentTitle} (${ev.provisionNumber}) is REPEALED as of ${ev.effectiveUntil?.slice(0, 10) || 'present'}; verify savings clauses for pre-repeal acts.`
        );
      }
      if (ev.status === 'PARTIAL_COMMENCEMENT') {
        hasUncertainCommencement = true;
        notes.push(
          `${ev.documentTitle} (${ev.provisionNumber}) has partial commencement; verify notification dates for the specific section.`
        );
      }
    }

    return {
      eventDate: eventDateStr,
      asOfDate,
      criminalLawRegime,
      notes: [...new Set(notes)],
      hasUncertainCommencement,
    };
  }
}

export const temporalAnalysisService = new TemporalAnalysisService();
export default temporalAnalysisService;
