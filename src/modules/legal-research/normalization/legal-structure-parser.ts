import { IngestLegalProvisionInput } from '../ingestion/legal-ingestion.service';
import { LegalDocumentType } from '@prisma/client';

export class LegalStructureParser {
  /**
   * Parses raw extracted legal text into structured provisions (Articles, Sections,
   * Rules, Regulations, or numbered Judgment paragraphs) without altering wording.
   */
  parseProvisions(
    text: string,
    documentType: LegalDocumentType,
    fallbackTitle: string
  ): IngestLegalProvisionInput[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const isJudgment =
      documentType === 'SUPREME_COURT_JUDGMENT' ||
      documentType === 'HIGH_COURT_JUDGMENT' ||
      documentType === 'TRIBUNAL_DECISION';

    if (isJudgment) {
      return this.parseJudgmentParagraphs(trimmed, fallbackTitle);
    }

    const provisionRegex =
      /(?:^|\n)\s*((?:Article|Section|Rule|Regulation)\s+\d+[A-Za-z]?)\s*[.:\-–—]?\s*([^\n]*)/gi;
    const matches: Array<{
      index: number;
      label: string;
      heading: string;
      type: 'ARTICLE' | 'SECTION' | 'RULE' | 'REGULATION';
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = provisionRegex.exec(trimmed)) !== null) {
      const label = match[1].replace(/\s+/g, ' ').trim();
      const lower = label.toLowerCase();
      const type = lower.startsWith('article')
        ? 'ARTICLE'
        : lower.startsWith('rule')
          ? 'RULE'
          : lower.startsWith('regulation')
            ? 'REGULATION'
            : 'SECTION';

      matches.push({
        index: match.index,
        label,
        heading: match[2]?.trim() || label,
        type,
      });
    }

    if (matches.length === 0) {
      return [
        {
          provisionType:
            documentType === 'CONSTITUTION'
              ? 'ARTICLE'
              : documentType === 'RULE'
                ? 'RULE'
                : documentType === 'REGULATION'
                  ? 'REGULATION'
                  : 'SECTION',
          provisionNumber: 'Full Text',
          heading: fallbackTitle,
          hierarchyPath: 'Document/Full Text',
          sortOrder: 0,
          exactText: trimmed,
        },
      ];
    }

    const provisions: IngestLegalProvisionInput[] = [];
    const seenPaths = new Set<string>();

    for (let i = 0; i < matches.length; i++) {
      const cur = matches[i];
      const nextIdx = i + 1 < matches.length ? matches[i + 1].index : trimmed.length;
      const body = trimmed.slice(cur.index, nextIdx).trim();
      if (!body) continue;

      let hierarchyPath = cur.label;
      if (seenPaths.has(hierarchyPath)) {
        hierarchyPath = `${cur.label}#${i + 1}`;
      }
      seenPaths.add(hierarchyPath);

      provisions.push({
        provisionType: cur.type,
        provisionNumber: cur.label,
        heading: cur.heading.slice(0, 200),
        hierarchyPath,
        sortOrder: i,
        exactText: body,
      });
    }

    return provisions;
  }

  private parseJudgmentParagraphs(text: string, fallbackTitle: string): IngestLegalProvisionInput[] {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20);

    if (paragraphs.length === 0) {
      return [
        {
          provisionType: 'CLAUSE',
          provisionNumber: 'Para 1',
          heading: fallbackTitle,
          hierarchyPath: 'Judgment/Para 1',
          sortOrder: 0,
          exactText: text,
        },
      ];
    }

    // Group paragraphs into 3-paragraph legal-aware blocks
    const grouped: IngestLegalProvisionInput[] = [];
    for (let i = 0; i < paragraphs.length; i += 3) {
      const slice = paragraphs.slice(i, i + 3);
      const startPara = i + 1;
      const endPara = i + slice.length;
      const label = startPara === endPara ? `Para ${startPara}` : `Paras ${startPara}-${endPara}`;
      grouped.push({
        provisionType: 'CLAUSE',
        provisionNumber: label,
        heading: `${fallbackTitle} (${label})`,
        hierarchyPath: `Judgment/${label}`,
        sortOrder: grouped.length,
        exactText: slice.join('\n\n'),
      });
    }
    return grouped;
  }
}

export const legalStructureParser = new LegalStructureParser();
export default legalStructureParser;
