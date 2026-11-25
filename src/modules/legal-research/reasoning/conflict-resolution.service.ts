import { CanonicalLegalEvidence } from '../schemas/legal-query.schema';
import { sourceValidator } from '../verification/source-validator';

export class ConflictResolutionService {
  /**
   * Orders evidence by authority tier, verification status, and specificity
   * (e.g., Primary Legislation > Binding Judicial > Persuasive > Secondary),
   * flagging potential conflicts rather than silently discarding them.
   */
  prioritizeAndDetectConflicts(evidence: CanonicalLegalEvidence[]): {
    ordered: CanonicalLegalEvidence[];
    conflictNotes: string[];
  } {
    const conflictNotes: string[] = [];

    const ordered = [...evidence].sort((a, b) => {
      const rankA = sourceValidator.getAuthorityRank(a.authorityTier);
      const rankB = sourceValidator.getAuthorityRank(b.authorityTier);
      if (rankA !== rankB) return rankB - rankA;
      return b.score - a.score;
    });

    const hasRepealed = ordered.some((e) => e.status === 'REPEALED');
    const hasActive = ordered.some((e) => e.status === 'ACTIVE');
    if (hasRepealed && hasActive) {
      conflictNotes.push(
        'Both repealed and currently active statutory provisions were retrieved; applicability depends strictly on the event date and savings clauses.'
      );
    }

    return { ordered, conflictNotes };
  }
}

export const conflictResolutionService = new ConflictResolutionService();
export default conflictResolutionService;
