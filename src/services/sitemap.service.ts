import { XMLParser } from 'fast-xml-parser';
import { validateSafeUrl, normalizeUrl, matchesPatterns } from '../utils/url';
import logger from '../lib/logger';
import { SitemapEntry, ParseSitemapOptions } from '../types';

export class SitemapService {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
      parseTagValue: false,
    });
  }

  /**
   * Fetches and recursively parses a sitemap or sitemap index.
   */
  async fetchAndParse(
    sitemapUrl: string,
    options: ParseSitemapOptions = {}
  ): Promise<SitemapEntry[]> {
    const {
      allowedHosts = [],
      includePatterns = [],
      excludePatterns = [],
      maxPages = 1000,
      timeoutMs = 15000,
    } = options;

    const visitedSitemaps = new Set<string>();
    const discoveredUrls = new Map<string, SitemapEntry>();

    const parseRecursive = async (currentUrl: string, depth = 0): Promise<void> => {
      if (depth > 5 || visitedSitemaps.has(currentUrl) || discoveredUrls.size >= maxPages) {
        return;
      }
      visitedSitemaps.add(currentUrl);

      logger.debug(`Fetching sitemap: ${currentUrl}`, { depth });

      let xmlData: string;
      try {
        validateSafeUrl(currentUrl, allowedHosts);

        const response = await fetch(currentUrl, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': 'WebsiteCrawler/1.0',
            Accept: 'application/xml, text/xml, */*',
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch sitemap: ${currentUrl} (Status: ${response.status})`);
          return;
        }

        xmlData = await response.text();
      } catch (err) {
        logger.warn(`Error fetching sitemap ${currentUrl}: ${(err as Error).message}`);
        return;
      }

      let parsed: any;
      try {
        parsed = this.parser.parse(xmlData);
      } catch (err) {
        logger.warn(`Malformed XML in sitemap ${currentUrl}: ${(err as Error).message}`);
        return;
      }

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      // 1. Check if it is a Sitemap Index (<sitemapindex>)
      if (parsed.sitemapindex && parsed.sitemapindex.sitemap) {
        const sitemaps = Array.isArray(parsed.sitemapindex.sitemap)
          ? parsed.sitemapindex.sitemap
          : [parsed.sitemapindex.sitemap];

        for (const sm of sitemaps) {
          if (discoveredUrls.size >= maxPages) break;
          const loc = sm.loc ? String(sm.loc).trim() : null;
          if (loc) {
            const normalizedSitemap = normalizeUrl(loc);
            if (normalizedSitemap && !visitedSitemaps.has(normalizedSitemap)) {
              await parseRecursive(normalizedSitemap, depth + 1);
            }
          }
        }
        return;
      }

      // 2. Check if it is a standard Sitemap (<urlset>)
      if (parsed.urlset && parsed.urlset.url) {
        const urls = Array.isArray(parsed.urlset.url) ? parsed.urlset.url : [parsed.urlset.url];

        for (const item of urls) {
          if (discoveredUrls.size >= maxPages) break;
          const loc = item.loc ? String(item.loc).trim() : null;
          if (!loc) continue;

          const normalized = normalizeUrl(loc);
          if (!normalized) continue;

          if (discoveredUrls.has(normalized)) continue;

          try {
            validateSafeUrl(normalized, allowedHosts);
          } catch {
            continue;
          }

          if (!matchesPatterns(normalized, includePatterns, excludePatterns)) {
            continue;
          }

          const entry: SitemapEntry = {
            url: normalized,
            lastmod: item.lastmod ? String(item.lastmod).trim() : undefined,
            changefreq: item.changefreq ? String(item.changefreq).trim() : undefined,
            priority: item.priority ? parseFloat(String(item.priority)) : undefined,
          };

          discoveredUrls.set(normalized, entry);
        }
      }
    };

    await parseRecursive(sitemapUrl, 0);

    const result = Array.from(discoveredUrls.values());
    logger.info(`Discovered ${result.length} URLs from sitemap ${sitemapUrl}`);
    return result;
  }
}

export const sitemapService = new SitemapService();
export default sitemapService;
export { SitemapEntry, ParseSitemapOptions };
