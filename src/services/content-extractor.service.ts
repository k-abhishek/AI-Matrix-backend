import * as cheerio from 'cheerio';
import { normalizeUrl } from '../utils/url';
import { ExtractedPageContent } from '../types';

export class ContentExtractorService {
  /**
   * Cleans and extracts core text content and metadata from raw HTML.
   * Note: JavaScript-rendered content unavailable in the original HTML response
   * cannot be extracted by Cheerio.
   */
  extract(html: string, originalUrl: string): ExtractedPageContent {
    const $ = cheerio.load(html);

    // Remove boilerplate, ads, interactive elements and non-content tags
    $(
      [
        'script',
        'style',
        'noscript',
        'iframe',
        'svg',
        'nav',
        'footer',
        'header',
        'aside',
        'form',
        'button',
        'canvas',
        'audio',
        'video',
        '[aria-hidden="true"]',
        '[role="dialog"]',
        '[role="alertdialog"]',
        '[aria-modal="true"]',
        '.cookie-banner',
        '.cookie-consent',
        '.cookies',
        '[class*="cookie"]',
        '[id*="cookie"]',
        '[class*="modal"]',
        '[class*="advert"]',
        '[id*="advert"]',
        '[class*="popup"]',
      ].join(', ')
    ).remove();

    // 1. Title extraction
    const rawTitle =
      $('title').first().text().trim() ||
      $('meta[property="og:title"]').attr('content')?.trim() ||
      $('h1').first().text().trim() ||
      '';
    const title = this.cleanWhitespace(rawTitle);

    // 2. Meta description
    const rawDescription =
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      '';
    const description = this.cleanWhitespace(rawDescription);

    // 3. Canonical URL
    const canonicalHref = $('link[rel="canonical"]').attr('href')?.trim();
    let canonicalUrl = originalUrl;
    if (canonicalHref) {
      const normalizedCanonical = normalizeUrl(canonicalHref, originalUrl);
      if (normalizedCanonical) {
        canonicalUrl = normalizedCanonical;
      }
    }

    // 4. Headings extraction (H1 - H6)
    const headings: string[] = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const text = this.cleanWhitespace($(el).text());
      if (text && text.length > 1 && !headings.includes(text)) {
        headings.push(text);
      }
    });

    // 5. Main content container priority
    let container = $('main');
    if (container.length === 0 || !container.text().trim()) {
      container = $('article');
    }
    if (container.length === 0 || !container.text().trim()) {
      container = $('[role="main"]');
    }
    if (container.length === 0 || !container.text().trim()) {
      container = $('body');
    }

    // Process block elements inside the container to preserve paragraph structure
    const textPieces: string[] = [];
    container.find('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th').each((_, el) => {
      const piece = this.cleanWhitespace($(el).text());
      if (piece && piece.length > 2) {
        textPieces.push(piece);
      }
    });

    let cleanedContent = textPieces.join('\n\n');

    // Fallback if structured block extraction yields too little text
    if (cleanedContent.length < 50) {
      cleanedContent = this.cleanWhitespace(container.text());
    }

    return {
      url: originalUrl,
      canonicalUrl,
      title,
      description,
      headings,
      content: cleanedContent,
    };
  }

  private cleanWhitespace(str: string): string {
    return str
      .replace(/[\r\t\f\v]/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/ +/g, ' ')
      .replace(/\n\s*\n+/g, '\n\n')
      .trim();
  }
}

export const contentExtractorService = new ContentExtractorService();
export default contentExtractorService;
export { ExtractedPageContent };
