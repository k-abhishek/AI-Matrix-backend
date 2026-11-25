import { XMLParser } from 'fast-xml-parser';
import mammoth from 'mammoth';
import contentExtractorService from '../../../services/content-extractor.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

export interface ExtractedLegalContent {
  title: string;
  text: string;
  pageTexts: Array<{ pageNumber: number; text: string }>;
  isScannedOrEmpty: boolean;
  ocrUsed: boolean;
  ocrConfidence?: number;
  extractionNotes: string[];
}

export class LegalDocumentExtractor {
  private xmlParser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });

  async extract(
    buffer: Buffer,
    mimeType: string,
    url: string,
    fallbackTitle: string
  ): Promise<ExtractedLegalContent> {
    const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    const lowerUrl = url.toLowerCase();

    if (cleanMime === 'application/pdf' || lowerUrl.endsWith('.pdf')) {
      return this.extractPdf(buffer, fallbackTitle);
    }

    if (
      cleanMime.includes('wordprocessingml') ||
      lowerUrl.endsWith('.docx')
    ) {
      return this.extractDocx(buffer, fallbackTitle);
    }

    if (cleanMime.includes('html') || lowerUrl.endsWith('.html') || lowerUrl.endsWith('.htm')) {
      return this.extractHtml(buffer.toString('utf-8'), url, fallbackTitle);
    }

    if (cleanMime.includes('xml') || lowerUrl.endsWith('.xml')) {
      return this.extractXml(buffer.toString('utf-8'), fallbackTitle);
    }

    if (cleanMime.includes('json') || lowerUrl.endsWith('.json')) {
      return this.extractJson(buffer.toString('utf-8'), fallbackTitle);
    }

    const text = buffer.toString('utf-8').trim();
    return {
      title: fallbackTitle,
      text,
      pageTexts: [{ pageNumber: 1, text }],
      isScannedOrEmpty: text.length < 30,
      ocrUsed: false,
      extractionNotes: [],
    };
  }

  private async extractPdf(buffer: Buffer, fallbackTitle: string): Promise<ExtractedLegalContent> {
    const pageTexts: Array<{ pageNumber: number; text: string }> = [];
    let currentPage = 0;

    const data = await pdfParse(buffer, {
      pagerender: (pageData: any) => {
        currentPage += 1;
        return pageData.getTextContent().then((textContent: any) => {
          const pageStr = (textContent.items || [])
            .map((item: any) => item.str)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          pageTexts.push({ pageNumber: currentPage, text: pageStr });
          return pageStr;
        });
      },
    });

    const text = (data.text || '').trim();
    const isScannedOrEmpty = text.length < 50;
    const notes: string[] = [];
    if (isScannedOrEmpty) {
      notes.push('PDF contains little or no selectable text (likely scanned image; OCR required).');
    }

    return {
      title: data.info?.Title?.trim() || fallbackTitle,
      text,
      pageTexts: pageTexts.length > 0 ? pageTexts : [{ pageNumber: 1, text }],
      isScannedOrEmpty,
      ocrUsed: false,
      extractionNotes: notes,
    };
  }

  private async extractDocx(buffer: Buffer, fallbackTitle: string): Promise<ExtractedLegalContent> {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '').trim();
    return {
      title: fallbackTitle,
      text,
      pageTexts: [{ pageNumber: 1, text }],
      isScannedOrEmpty: text.length < 30,
      ocrUsed: false,
      extractionNotes: result.messages.map((m) => m.message),
    };
  }

  private extractHtml(html: string, url: string, fallbackTitle: string): ExtractedLegalContent {
    const extracted = contentExtractorService.extract(html, url);
    const text = extracted.content.trim();
    return {
      title: extracted.title || fallbackTitle,
      text,
      pageTexts: [{ pageNumber: 1, text }],
      isScannedOrEmpty: text.length < 30,
      ocrUsed: false,
      extractionNotes: [],
    };
  }

  private extractXml(xml: string, fallbackTitle: string): ExtractedLegalContent {
    const parsed = this.xmlParser.parse(xml);
    const text = JSON.stringify(parsed, null, 2);
    return {
      title: fallbackTitle,
      text,
      pageTexts: [{ pageNumber: 1, text }],
      isScannedOrEmpty: text.length < 30,
      ocrUsed: false,
      extractionNotes: [],
    };
  }

  private extractJson(raw: string, fallbackTitle: string): ExtractedLegalContent {
    const parsed = JSON.parse(raw);
    const text = JSON.stringify(parsed, null, 2);
    return {
      title: parsed?.title || fallbackTitle,
      text,
      pageTexts: [{ pageNumber: 1, text }],
      isScannedOrEmpty: text.length < 30,
      ocrUsed: false,
      extractionNotes: [],
    };
  }
}

export const legalDocumentExtractor = new LegalDocumentExtractor();
export default legalDocumentExtractor;
