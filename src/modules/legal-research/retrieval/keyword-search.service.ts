import legalProvisionRepository from '../knowledge/legal-provision.repository';
import { LegalRetrievalOptions, RetrievedLegalChunk } from '../schemas/legal-query.schema';

const STOP_WORDS = new Set([
  'the', 'is', 'in', 'at', 'of', 'on', 'for', 'to', 'a', 'an', 'and', 'or',
  'what', 'which', 'who', 'when', 'where', 'how', 'can', 'my', 'me', 'are',
  'under', 'with', 'without', 'has', 'have', 'been', 'from', 'that', 'this',
  'does', 'do', 'if', 'about', 'against', 'into', 'than', 'then',
]);

export class KeywordLegalSearchService {
  extractTerms(query: string): string[] {
    return query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
      .slice(0, 6);
  }

  async search(
    query: string,
    options: LegalRetrievalOptions = {},
    limit = 10
  ): Promise<RetrievedLegalChunk[]> {
    const terms = this.extractTerms(query);
    if (terms.length === 0) return [];

    // Try full term intersection first, then broaden to top 2 key terms if needed
    let matches = await legalProvisionRepository.keywordSearchProvisions({
      terms: terms.slice(0, 3),
      jurisdiction: options.jurisdiction || 'IN',
      state: options.state,
      legalDomain: options.legalDomain,
      limit,
    });

    if (matches.length === 0 && terms.length > 1) {
      matches = await legalProvisionRepository.keywordSearchProvisions({
        terms: [terms[0]],
        jurisdiction: options.jurisdiction || 'IN',
        state: options.state,
        legalDomain: options.legalDomain,
        limit,
      });
    }

    return matches.map((pv, idx) => ({
      chunkId: `kw_${pv.id}`,
      documentId: pv.provision.documentId,
      provisionId: pv.provisionId,
      provisionVersionId: pv.id,
      score: Number(Math.max(0.4, 0.9 - idx * 0.05).toFixed(4)),
      source: 'KEYWORD',
      metadata: {
        documentId: pv.provision.documentId,
        provisionId: pv.provisionId,
        provisionVersionId: pv.id,
        jurisdiction: pv.provision.document.jurisdiction,
        state: pv.provision.document.state ?? undefined,
        legalDomain: pv.provision.document.legalDomain,
        documentType: pv.provision.document.documentType,
        verificationStatus: pv.provision.document.verificationStatus,
      },
    }));
  }
}

export const keywordLegalSearchService = new KeywordLegalSearchService();
export default keywordLegalSearchService;
