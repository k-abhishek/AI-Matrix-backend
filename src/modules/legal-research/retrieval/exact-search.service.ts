import legalProvisionRepository from '../knowledge/legal-provision.repository';
import legalDocumentRepository from '../knowledge/legal-document.repository';
import legalCaseRepository from '../knowledge/legal-case.repository';
import { LegalRetrievalOptions, RetrievedLegalChunk } from '../schemas/legal-query.schema';

export interface ParsedLegalReference {
  provisionNumbers: string[];
  actHints: string[];
  caseCitations: string[];
}

export class ExactLegalSearchService {
  /**
   * Parses explicit statutory references (Article, Section, Rule, Regulation)
   * and Act/case hints from a natural-language query.
   */
  parseReferences(query: string): ParsedLegalReference {
    const provisionNumbers: string[] = [];
    const actHints: string[] = [];
    const caseCitations: string[] = [];

    const provRegex = /\b(Article|Section|Sec\.?|Rule|Regulation|Reg\.?)\s+(\d+[A-Za-z]?(?:\(\d+\))?)/gi;
    let match: RegExpExecArray | null;
    while ((match = provRegex.exec(query)) !== null) {
      const rawKind = match[1].toLowerCase();
      const kind = rawKind.startsWith('art')
        ? 'Article'
        : rawKind.startsWith('sec')
          ? 'Section'
          : rawKind.startsWith('rul')
            ? 'Rule'
            : 'Regulation';
      provisionNumbers.push(`${kind} ${match[2]}`);
    }

    const actRegex =
      /\b([A-Z][A-Za-z\s]+?(?:Act|Sanhita|Code|Constitution)(?:,\s*\d{4})?|\b(?:IPC|BNS|CrPC|BNSS|IEA|BSA|CGST|GST)\b)/g;
    while ((match = actRegex.exec(query)) !== null) {
      const hint = match[1].trim();
      if (hint.length >= 2) {
        actHints.push(hint);
      }
    }

    const citationRegex = /(\(\d{4}\)\s*\d+\s*SCC\s*\d+|\b\d{4}\s*SCC\s*OnLine\s*[A-Za-z]+\s*\d+|\bAIR\s*\d{4}\s*SC\s*\d+)\b/gi;
    while ((match = citationRegex.exec(query)) !== null) {
      caseCitations.push(match[1].trim());
    }

    return {
      provisionNumbers: [...new Set(provisionNumbers)],
      actHints: [...new Set(actHints)],
      caseCitations: [...new Set(caseCitations)],
    };
  }

  async search(query: string, options: LegalRetrievalOptions = {}): Promise<RetrievedLegalChunk[]> {
    const refs = this.parseReferences(query);
    const results: RetrievedLegalChunk[] = [];
    const seenVersionIds = new Set<string>();

    // 1. Exact provision lookups
    for (const provNum of refs.provisionNumbers) {
      const actHint = refs.actHints[0];
      const provisions = await legalProvisionRepository.findExactProvision({
        provisionNumber: provNum,
        documentTitleOrShort: actHint,
        jurisdiction: options.jurisdiction || 'IN',
        state: options.state,
      });

      for (const prov of provisions) {
        const currentVer = prov.versions.find((v) => v.isCurrent) || prov.versions[0];
        if (!currentVer || seenVersionIds.has(currentVer.id)) continue;
        seenVersionIds.add(currentVer.id);

        results.push({
          chunkId: `exact_${currentVer.id}`,
          documentId: prov.documentId,
          provisionId: prov.id,
          provisionVersionId: currentVer.id,
          score: 1.0,
          source: 'EXACT',
          metadata: {
            documentId: prov.documentId,
            provisionId: prov.id,
            provisionVersionId: currentVer.id,
            jurisdiction: prov.document.jurisdiction,
            state: prov.document.state ?? undefined,
            legalDomain: prov.document.legalDomain,
            documentType: prov.document.documentType,
            verificationStatus: prov.document.verificationStatus,
          },
        });
      }
    }

    // 2. Act-level lookup when Act name/shortTitle is mentioned without section
    if (refs.provisionNumbers.length === 0 && refs.actHints.length > 0) {
      for (const hint of refs.actHints.slice(0, 3)) {
        const docs = await legalDocumentRepository.findByTitleOrShortTitle(hint, 3);
        for (const doc of docs) {
          const provs = await legalProvisionRepository.findExactProvision({
            provisionNumber: '',
            documentId: doc.id,
            jurisdiction: options.jurisdiction || 'IN',
            state: options.state,
          }).catch(() => []);
          void provs;
        }
      }
    }

    // 3. Case citation lookup
    for (const cit of refs.caseCitations) {
      const cases = await legalCaseRepository.searchCaseLaw({
        query: cit,
        jurisdiction: options.jurisdiction || 'IN',
        limit: 5,
      });
      for (const c of cases) {
        const firstProv = c.document.provisions[0];
        const firstVer = firstProv?.versions[0];
        if (!firstProv || !firstVer || seenVersionIds.has(firstVer.id)) continue;
        seenVersionIds.add(firstVer.id);

        results.push({
          chunkId: `exact_case_${firstVer.id}`,
          documentId: c.documentId,
          provisionId: firstProv.id,
          provisionVersionId: firstVer.id,
          score: 0.98,
          source: 'EXACT',
          metadata: {
            documentId: c.documentId,
            provisionId: firstProv.id,
            provisionVersionId: firstVer.id,
            jurisdiction: c.document.jurisdiction,
            legalDomain: c.document.legalDomain,
            documentType: c.document.documentType,
            court: c.court,
            judgmentDate: c.judgmentDate.toISOString(),
            verificationStatus: c.verificationStatus,
          },
        });
      }
    }

    return results;
  }
}

export const exactLegalSearchService = new ExactLegalSearchService();
export default exactLegalSearchService;
