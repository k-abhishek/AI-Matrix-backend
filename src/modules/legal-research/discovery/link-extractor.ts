import * as cheerio from 'cheerio';
import { normalizeUrl, validateSafeUrl } from '../../../utils/url';

const SUPPORTED_DOC_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xml', '.json', '.txt', '.html', '.htm',
]);

const LEGAL_PRIORITY_KEYWORDS = [
  'constitution', 'bharatiya nyaya sanhita', 'bns', 'bnss', 'bsa',
  'indian penal code', 'ipc', 'crpc', 'evidence act', 'companies act',
  'contract act', 'information technology', 'judgment', 'judgement',
  'order', 'gazette', 'act', 'amendment', 'notification', 'bitstream',
];

export interface ExtractedLink {
  url: string;
  canonicalUrl: string;
  title: string;
  fileType: string;
  isDocumentCandidate: boolean;
  priorityScore: number;
}

export class LegalLinkExtractor {
  inferFileType(url: string): string {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      for (const ext of SUPPORTED_DOC_EXTENSIONS) {
        if (pathname.endsWith(ext)) {
          return ext.slice(1).toUpperCase();
        }
      }
      if (pathname.includes('/bitstream/')) return 'PDF';
      return 'HTML';
    } catch {
      return 'HTML';
    }
  }

  extractLinks(
    html: string,
    pageUrl: string,
    allowedHosts: string[],
    excludePatterns: string[] = []
  ): ExtractedLink[] {
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const links: ExtractedLink[] = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')?.trim();
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
        return;
      }

      const normalized = normalizeUrl(href, pageUrl);
      if (!normalized || seen.has(normalized)) return;

      try {
        validateSafeUrl(normalized, allowedHosts);
      } catch {
        return;
      }

      if (excludePatterns.some((pat) => normalized.toLowerCase().includes(pat.toLowerCase()))) {
        return;
      }

      seen.add(normalized);
      const anchorText = $(el).text().replace(/\s+/g, ' ').trim();
      const titleAttr = $(el).attr('title')?.trim() || '';
      const title = anchorText || titleAttr || normalized.split('/').pop() || normalized;

      const fileType = this.inferFileType(normalized);
      const combined = `${normalized} ${title}`.toLowerCase();
      let priorityScore = 0;
      for (const kw of LEGAL_PRIORITY_KEYWORDS) {
        if (combined.includes(kw)) priorityScore += 1;
      }

      const isDocumentCandidate =
        fileType !== 'HTML' ||
        priorityScore > 0 ||
        normalized.includes('/handle/');

      links.push({
        url: normalized,
        canonicalUrl: normalized,
        title: title.slice(0, 300),
        fileType,
        isDocumentCandidate,
        priorityScore,
      });
    });

    return links.sort((a, b) => b.priorityScore - a.priorityScore);
  }
}

export const legalLinkExtractor = new LegalLinkExtractor();
export default legalLinkExtractor;
