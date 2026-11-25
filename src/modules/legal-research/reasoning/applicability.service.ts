import { CanonicalLegalEvidence } from '../schemas/legal-query.schema';
import { LegalJurisdictionInfo } from '../schemas/legal-state.schema';
import { TemporalApplicabilityAssessment } from './temporal-analysis.service';

export interface ApplicabilityCheckResult {
  applicableEvidence: CanonicalLegalEvidence[];
  excludedEvidence: Array<{ evidenceId: string; reason: string }>;
  notes: string[];
}

export class ApplicabilityService {
  filterAndAssess(params: {
    evidence: CanonicalLegalEvidence[];
    jurisdiction: LegalJurisdictionInfo;
    temporal: TemporalApplicabilityAssessment;
  }): ApplicabilityCheckResult {
    const { evidence, jurisdiction, temporal } = params;
    const applicableEvidence: CanonicalLegalEvidence[] = [];
    const excludedEvidence: Array<{ evidenceId: string; reason: string }> = [];
    const notes: string[] = [...temporal.notes];

    const eventDate = temporal.eventDate ? new Date(temporal.eventDate) : null;

    for (const ev of evidence) {
      // Jurisdiction state check: if evidence is state-specific and differs from target state
      if (
        ev.state &&
        jurisdiction.state &&
        ev.state.toLowerCase() !== jurisdiction.state.toLowerCase()
      ) {
        excludedEvidence.push({
          evidenceId: ev.evidenceId,
          reason: `State mismatch: provision belongs to ${ev.state}, query jurisdiction is ${jurisdiction.state}`,
        });
        continue;
      }

      // Temporal effective-date check when eventDate is known
      if (eventDate && !Number.isNaN(eventDate.getTime())) {
        const from = ev.effectiveFrom ? new Date(ev.effectiveFrom) : null;
        const until = ev.effectiveUntil ? new Date(ev.effectiveUntil) : null;

        if (from && eventDate < from) {
          excludedEvidence.push({
            evidenceId: ev.evidenceId,
            reason: `Not yet in force on ${temporal.eventDate} (effective from ${ev.effectiveFrom?.slice(0, 10)})`,
          });
          continue;
        }
        if (until && eventDate >= until) {
          excludedEvidence.push({
            evidenceId: ev.evidenceId,
            reason: `Superseded/repealed prior to ${temporal.eventDate} (effective until ${ev.effectiveUntil?.slice(0, 10)})`,
          });
          continue;
        }
      }

      applicableEvidence.push(ev);
    }

    return {
      applicableEvidence,
      excludedEvidence,
      notes,
    };
  }
}

export const applicabilityService = new ApplicabilityService();
export default applicabilityService;
